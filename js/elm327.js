/**
 * ELM327 Protocol Driver & Transport Layer
 * Поддержка Web Serial API (USB / Bluetooth COM-порт),
 * Web Bluetooth API (BLE 4.0+) и встроенного симулятора Mazda 6 GH.
 */

// Стандартные UUID для BLE OBD2 адаптеров (Vgate, Veepeak, OBDLink, generic ELM327 BLE)
const BLE_SERVICES = [
  // FFE0 Custom Serial (самый распространенный в китайских BLE ELM327 и Vgate)
  { service: '0000ffe0-0000-1000-8000-00805f9b34fb', tx: '0000ffe1-0000-1000-8000-00805f9b34fb', rx: '0000ffe1-0000-1000-8000-00805f9b34fb' },
  // FFF0 Alternative
  { service: '0000fff0-0000-1000-8000-00805f9b34fb', tx: '0000fff2-0000-1000-8000-00805f9b34fb', rx: '0000fff1-0000-1000-8000-00805f9b34fb' },
  // Nordic UART Service (NUS)
  { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' }
];

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (typeof navigator.platform === 'string' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export class Elm327Driver {
  constructor() {
    this.transport = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.transportType = null;
    this.buffer = '';
    this.onTraffic = null; // (dir: 'TX'|'RX', data: string) => void
    this.onStateChange = null; // (state: string, details?: any) => void
  }

  /**
   * Проверка поддержки браузером Web Serial API
   */
  static isSerialSupported() {
    return 'serial' in navigator;
  }

  /**
   * Проверка поддержки браузером Web Bluetooth API
   */
  static isBluetoothSupported() {
    return 'bluetooth' in navigator;
  }

  /**
   * Подключение к адаптеру
   * @param {'serial' | 'bluetooth' | 'demo'} type
   * @param {Object} options
   */
  async connect(type = 'serial', options = { baudRate: 38400 }) {
    if (this.isConnected) {
      await this.disconnect();
    }

    this.isConnecting = true;
    this._notifyState('connecting', { type });

    try {
      if (type === 'serial') {
        this.transport = new WebSerialTransport(options.baudRate || 38400);
      } else if (type === 'bluetooth') {
        this.transport = new WebBluetoothTransport();
      } else if (type === 'demo') {
        this.transport = new SimulatorTransport();
      } else {
        throw new Error(`Неизвестный тип подключения: ${type}`);
      }

      this.transport.onData = (chunk) => this._handleIncomingData(chunk);
      this.transport.onError = (err) => this._handleError(err);
      this.transport.onClose = () => this.disconnect();

      await this.transport.open();

      this.transportType = type;
      this.isConnected = true;
      this.isConnecting = false;
      this._notifyState('connected', { type });

      return true;
    } catch (err) {
      this.isConnecting = false;
      this.isConnected = false;
      this.transport = null;
      this._notifyState('error', { error: err.message || err });
      throw err;
    }
  }

  /**
   * Отключение
   */
  async disconnect() {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (e) {
        console.warn('Ошибка при закрытии транспорта:', e);
      }
      this.transport = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.buffer = '';
    this._notifyState('disconnected');
  }

  /**
   * Отправка команды в ELM327 и ожидание ответа до появления символа '>'
   * @param {string} command 
   * @param {number} timeoutMs 
   * @returns {Promise<string>}
   */
  async sendCommand(command, timeoutMs = 2500) {
    if (!this.isConnected || !this.transport) {
      throw new Error('ELM327 не подключен');
    }

    const cleanCmd = command.trim();
    if (this.onTraffic) this.onTraffic('TX', cleanCmd);

    this.buffer = ''; // Очищаем буфер перед новой командой

    return new Promise(async (resolve, reject) => {
      let timer = null;

      const checkResponse = () => {
        // Ответ готов, когда получен символ приглашения '>'
        if (this.buffer.includes('>')) {
          if (timer) clearTimeout(timer);
          this._responseHandler = null;

          // Очищаем результат от эха, символа '>' и лишних пробелов/переводов строк
          let res = this.buffer.replace('>', '').trim();
          if (this.onTraffic) this.onTraffic('RX', res);
          resolve(res);
        }
      };

      this._responseHandler = checkResponse;

      timer = setTimeout(() => {
        this._responseHandler = null;
        if (this.buffer.length > 0) {
          // Если что-то пришло, возвращаем даже без '>'
          const partial = this.buffer.replace('>', '').trim();
          if (this.onTraffic) this.onTraffic('RX', partial);
          resolve(partial);
        } else {
          reject(new Error(`Таймаут ожидания ответа на команду "${cleanCmd}"`));
        }
      }, timeoutMs);

      try {
        await this.transport.write(cleanCmd + '\r');
      } catch (err) {
        if (timer) clearTimeout(timer);
        this._responseHandler = null;
        reject(err);
      }
    });
  }

  _handleIncomingData(chunk) {
    this.buffer += chunk;
    if (this._responseHandler) {
      this._responseHandler();
    }
  }

  _handleError(err) {
    console.error('ELM327 Transport Error:', err);
    this._notifyState('error', { error: err.message || err });
  }

  _notifyState(state, details) {
    if (this.onStateChange) {
      this.onStateChange(state, details);
    }
  }
}

// ==========================================
// Транспорт 1: Web Serial API (USB / Bluetooth COM)
// ==========================================
class WebSerialTransport {
  constructor(baudRate = 38400) {
    this.baudRate = baudRate;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isReading = false;
    this.onData = null;
    this.onError = null;
    this.onClose = null;
  }

  async open() {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API не поддерживается данным браузером. Используйте Google Chrome или Microsoft Edge.');
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: this.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      bufferSize: 4096
    });

    this.writer = this.port.writable.getWriter();
    this._startReading();
  }

  async _startReading() {
    this.isReading = true;
    const textDecoder = new TextDecoderStream();
    this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    try {
      while (this.isReading) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && this.onData) {
          this.onData(value);
        }
      }
    } catch (err) {
      if (this.isReading && this.onError) {
        this.onError(err);
      }
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
      }
    }
  }

  async write(data) {
    if (!this.writer) throw new Error('Порт не готов к записи');
    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(data));
  }

  async close() {
    this.isReading = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (e) {}
    }
    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch (e) {}
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch (e) {}
    }
  }
}

// ==========================================
// Транспорт 2: Web Bluetooth API (BLE 4.0+)
// ==========================================
class WebBluetoothTransport {
  constructor() {
    this.device = null;
    this.server = null;
    this.txChar = null;
    this.rxChar = null;
    this.onData = null;
    this.onError = null;
    this.onClose = null;
  }

  async open() {
    if (!('bluetooth' in navigator)) {
      if (isIos()) {
        throw new Error('IOS_SAFARI_BLOCKED');
      }
      throw new Error('Web Bluetooth API не поддерживается данным браузером или ОС. Требуется Chrome/Edge с включенным Bluetooth.');
    }

    const optionalServices = BLE_SERVICES.map(s => s.service);

    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: optionalServices
      });
    } catch (e) {
      if (e.name !== 'NotFoundError' && e.name !== 'SecurityError') {
        // Fallback for browsers requiring explicit name prefixes or services
        this.device = await navigator.bluetooth.requestDevice({
          filters: [
            { services: ['0000ffe0-0000-1000-8000-00805f9b34fb'] },
            { services: ['0000fff0-0000-1000-8000-00805f9b34fb'] },
            { services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] },
            { namePrefix: 'OBD' },
            { namePrefix: 'V-LINK' },
            { namePrefix: 'IOS-Vlink' },
            { namePrefix: 'CLKDevices' },
            { namePrefix: 'iCar' },
            { namePrefix: 'ELM' },
            { namePrefix: 'Viecar' },
            { namePrefix: 'BT' },
            { namePrefix: 'vgate' },
            { namePrefix: 'Konnwei' }
          ],
          optionalServices: optionalServices
        });
      } else {
        throw e;
      }
    }

    this.device.addEventListener('gattserverdisconnected', () => {
      if (this.onClose) this.onClose();
    });

    this.server = await this.device.gatt.connect();

    // Ищем подходящий сервис UART
    let matchedConfig = null;
    let service = null;

    for (const conf of BLE_SERVICES) {
      try {
        service = await this.server.getPrimaryService(conf.service);
        matchedConfig = conf;
        break;
      } catch (e) {
        // Пробуем следующий сервис
      }
    }

    if (!service || !matchedConfig) {
      throw new Error('Не найден подходящий UART/Serial сервис на данном Bluetooth устройстве.');
    }

    this.txChar = await service.getCharacteristic(matchedConfig.tx);
    this.rxChar = matchedConfig.tx === matchedConfig.rx
      ? this.txChar
      : await service.getCharacteristic(matchedConfig.rx);

    // Подписка на уведомления от RX
    await this.rxChar.startNotifications();
    this.rxChar.addEventListener('characteristicvaluechanged', (event) => {
      const decoder = new TextDecoder('utf-8');
      const val = decoder.decode(event.target.value);
      if (this.onData) this.onData(val);
    });
  }

  async write(data) {
    if (!this.txChar) throw new Error('Bluetooth BLE не готов к отправке');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    if (this.txChar.writeValueWithoutResponse) {
      await this.txChar.writeValueWithoutResponse(bytes);
    } else {
      await this.txChar.writeValue(bytes);
    }
  }

  async close() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }
}

// ==========================================
// Транспорт 3: Симулятор Mazda 6 GH (Demo Mode)
// ==========================================
class SimulatorTransport {
  constructor() {
    this.onData = null;
    this.onError = null;
    this.onClose = null;

    // Внутреннее состояние виртуальной Mazda 6 GH
    this.rpm = 740;
    this.speed = 0;
    this.coolant = 89;
    this.iat = 24;
    this.maf = 3.35;
    this.throttle = 13.8;
    this.fuelLevel = 68;
    this.load = 19.5;
    this.voltage = 14.15;
    this.stft = 1.2;
    this.ltft = -2.3;
    this.hasDtc = true; // Начальные симулируемые ошибки (P0421, P2187)
    this.time = 0;

    // Состояние дверей и багажника для теста CAN
    this.doorDriverOpen = false;
    this.doorPassengerOpen = false;
    this.trunkOpen = false;
    this.isCanStreaming = false;
    this.canStreamTimer = null;

    this.timer = setInterval(() => {
      this.time += 0.5;
      // Реалистичные колебания оборотов и скорости
      const rev = Math.sin(this.time * 0.3) > 0.4 ? Math.sin(this.time * 0.3) * 1600 : 0;
      this.rpm = Math.round(720 + Math.random() * 40 + rev);
      this.speed = Math.max(0, Math.round(rev > 200 ? (rev / 30) : 0));
      this.maf = parseFloat((3.1 + (this.rpm / 750) * 1.8 + Math.random() * 0.2).toFixed(2));
      this.throttle = parseFloat((13.5 + (this.rpm > 1000 ? (this.rpm - 750) / 100 : 0)).toFixed(1));
      this.load = parseFloat((18.0 + (this.rpm > 1000 ? 15 : 0) + Math.random() * 2).toFixed(1));
      this.stft = parseFloat((Math.sin(this.time) * 3.5).toFixed(1));
      this.voltage = parseFloat((14.1 + Math.random() * 0.15).toFixed(2));
    }, 400);
  }

  toggleDoor(type = 'driver') {
    if (type === 'driver') this.doorDriverOpen = !this.doorDriverOpen;
    if (type === 'passenger') this.doorPassengerOpen = !this.doorPassengerOpen;
    if (type === 'trunk') this.trunkOpen = !this.trunkOpen;
  }

  async open() {
    // Мгновенная готовность
    return true;
  }

  async write(data) {
    // Если активен мониторинг CAN (AT MA) и пришел любой символ для остановки
    if (this.isCanStreaming) {
      if (this.canStreamTimer) {
        clearInterval(this.canStreamTimer);
        this.canStreamTimer = null;
      }
      this.isCanStreaming = false;
      setTimeout(() => {
        if (this.onData) this.onData('\r\nSTOPPED\r\n>');
      }, 50);
      return;
    }

    const cmd = data.replace(/[\r\n]/g, '').trim().toUpperCase();

    if (cmd === 'ATMA' || cmd === 'AT MA') {
      this.isCanStreaming = true;
      this._startCanStream();
      return;
    }

    // Небольшая имитация сетевой задержки CAN-шины (40-90мс)
    setTimeout(() => {
      const resp = this._processSimCommand(cmd);
      if (this.onData) {
        this.onData(resp + '\r\n>');
      }
    }, 50);
  }

  _startCanStream() {
    let tick = 0;
    this.canStreamTimer = setInterval(() => {
      if (!this.isCanStreaming) return;
      tick++;

      // Вычисляем байт состояния дверей: 0x01=водитель, 0x02=пассажир, 0x10=багажник
      let doorByteVal = 0;
      if (this.doorDriverOpen) doorByteVal |= 0x01;
      if (this.doorPassengerOpen) doorByteVal |= 0x02;
      if (this.trunkOpen) doorByteVal |= 0x10;
      const doorHex = doorByteVal.toString(16).padStart(2, '0').toUpperCase();

      // Генерация пакетов CAN
      const frames = [];

      // 433: Двери и багажник BCM (передается каждые ~80мс)
      frames.push(`433 8 00 00 ${doorHex} 00 00 00 00 00`);

      // 201: Обороты двигателя
      if (tick % 2 === 0) {
        const rpmHex = (Math.round(this.rpm * 4) & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
        frames.push(`201 8 ${rpmHex.substring(0, 2)} ${rpmHex.substring(2, 4)} 00 12 00 00 00 00`);
      }

      // 420: Скорость и одометр
      if (tick % 3 === 0) {
        const spdHex = Math.round(this.speed).toString(16).padStart(2, '0').toUpperCase();
        frames.push(`420 8 00 ${spdHex} 12 34 56 00 00 00`);
      }

      // 430: Индикаторы приборной панели
      if (tick % 4 === 0) {
        frames.push(`430 8 00 ${doorByteVal > 0 ? '08' : '00'} 00 00 00 00 00 00`);
      }

      if (this.onData && frames.length > 0) {
        this.onData(frames.join('\r\n') + '\r\n');
      }
    }, 90);
  }

  _processSimCommand(cmd) {
    if (cmd === 'ATZ' || cmd === 'AT Z') return 'ELM327 v1.5';
    if (cmd === 'ATE0' || cmd === 'ATL0' || cmd === 'ATS0' || cmd === 'ATH0' || cmd === 'ATH1' || cmd === 'ATAT1') return 'OK';
    if (cmd.startsWith('ATSP')) return 'OK';
    if (cmd.startsWith('ATSH')) return 'OK';
    if (cmd === 'ATDP' || cmd === 'AT DP') return 'ISO 15765-4 (CAN 11/500)';
    if (cmd === 'ATRV' || cmd === 'AT RV') return `${this.voltage.toFixed(1)}V`;

    // Mode 01 - Live PIDs
    if (cmd === '0100') return '41 00 BE 3E B8 11'; // Поддерживаемые PIDs 01-20
    if (cmd === '0120') return '41 20 80 07 E0 11';

    if (cmd === '010C') {
      // RPM: formula: ((A*256)+B)/4
      const raw = Math.round(this.rpm * 4);
      const A = (raw >> 8) & 0xFF;
      const B = raw & 0xFF;
      return `41 0C ${A.toString(16).padStart(2, '0').toUpperCase()} ${B.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '010D') {
      // Speed: A (km/h)
      const A = Math.min(255, Math.max(0, Math.round(this.speed)));
      return `41 0D ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '0105') {
      // Coolant Temp: A - 40
      const A = Math.round(this.coolant + 40);
      return `41 05 ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '010F') {
      // IAT: A - 40
      const A = Math.round(this.iat + 40);
      return `41 0F ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '0110') {
      // MAF: ((A*256)+B)/100
      const raw = Math.round(this.maf * 100);
      const A = (raw >> 8) & 0xFF;
      const B = raw & 0xFF;
      return `41 10 ${A.toString(16).padStart(2, '0').toUpperCase()} ${B.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '0111') {
      // Throttle: A*100/255
      const A = Math.round((this.throttle * 255) / 100);
      return `41 11 ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '0104') {
      // Engine Load: A*100/255
      const A = Math.round((this.load * 255) / 100);
      return `41 04 ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '0106') {
      // STFT: (A-128)*100/128
      const A = Math.round(this.stft * 1.28 + 128);
      return `41 06 ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '0107') {
      // LTFT
      const A = Math.round(this.ltft * 1.28 + 128);
      return `41 07 ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '012F') {
      // Fuel Level %
      const A = Math.round((this.fuelLevel * 255) / 100);
      return `41 2F ${A.toString(16).padStart(2, '0').toUpperCase()}`;
    }

    if (cmd === '0114') {
      // O2 Sensor Bank 1 Sensor 1
      const voltByte = Math.round(0.85 * 200);
      return `41 14 ${voltByte.toString(16).padStart(2, '0').toUpperCase()} 80`;
    }

    if (cmd === '0115') {
      // O2 Sensor Bank 1 Sensor 2
      const voltByte = Math.round(0.72 * 200);
      return `41 15 ${voltByte.toString(16).padStart(2, '0').toUpperCase()} FF`;
    }

    // Mode 03 - DTCs
    if (cmd === '03') {
      if (!this.hasDtc) {
        return '43 00 00 00 00 00 00'; // Нет ошибок
      }
      // P0421 (04 21) и P2187 (21 87)
      return '43 04 21 21 87 00 00';
    }

    // Mode 07 - Pending DTCs
    if (cmd === '07') {
      if (!this.hasDtc) return '47 00 00 00 00 00 00';
      // P0328 (03 28)
      return '47 03 28 00 00 00 00';
    }

    // Mode 0A - Permanent DTCs
    if (cmd === '0A') {
      return '4A 00 00 00 00 00 00';
    }

    // Mode 04 - Сброс ошибок
    if (cmd === '04') {
      this.hasDtc = false;
      return '44';
    }

    return 'NO DATA';
  }

  async close() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
