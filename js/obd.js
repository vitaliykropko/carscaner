/**
 * Mazda 6 GH & OBD-II Protocol Engine
 * Обработка PIDs, CAN-сообщений, расшифровка параметров и чтение кодов ошибок.
 */

import { decodeDtc } from './dtc_db.js';

export class ObdEngine {
  constructor(elmDriver) {
    this.elm = elmDriver;
    this.protocol = 'Unknown';
    this.batteryVoltage = '0.0V';
    this.isPolling = false;
    this.pollingInterval = 300; // мс между опросами PIDs
    this.pollingTimer = null;
    this.onTelemetryUpdate = null; // (data: Object) => void
    this.supportedPids = new Set();
    this.activeModule = 'PCM'; // По умолчанию опрашиваем двигатель
  }

  /**
   * Инициализация адаптера ELM327 под Mazda 6 GH
   */
  async initialize() {
    // 1. Сброс
    await this._delay(100);
    const zResp = await this.elm.sendCommand('AT Z', 3000);
    await this._delay(300);

    // 2. Базовые настройки
    await this.elm.sendCommand('AT E0'); // Эхо выкл
    await this.elm.sendCommand('AT L0'); // Перевод строки выкл
    await this.elm.sendCommand('AT S0'); // Пробелы выкл
    await this.elm.sendCommand('AT H0'); // Заголовки выкл (включаем только при сканировании блоков)
    await this.elm.sendCommand('AT AT 1'); // Адаптивный тайминг включен

    // 3. Установка протокола: Для Mazda 6 GH штатно используется CAN 11 бит / 500 кбит/с (ISO 15765-4 CAN 11/500 = AT SP 6)
    try {
      await this.elm.sendCommand('AT SP 6');
    } catch (e) {
      // Если SP6 не прошел, ставим автоматический выбор
      await this.elm.sendCommand('AT SP 0');
    }

    // 4. Проверяем напряжение аккумулятора
    try {
      const v = await this.elm.sendCommand('AT RV');
      this.batteryVoltage = v.replace(/[^0-9.]/g, '') + 'V';
    } catch (e) {}

    // 5. Описание протокола
    try {
      this.protocol = await this.elm.sendCommand('AT DP');
    } catch (e) {
      this.protocol = 'ISO 15765-4 (CAN 11/500)';
    }

    // 6. Проверка поддерживаемых PIDs
    try {
      const pidsResp = await this.elm.sendCommand('0100');
      this._parseSupportedPids(pidsResp);
    } catch (e) {
      console.warn('Не удалось прочитать поддерживаемые PIDs:', e);
    }

    return {
      protocol: this.protocol,
      voltage: this.batteryVoltage
    };
  }

  /**
   * Запуск постоянного циклического опроса датчиков
   */
  startPolling(callback) {
    if (this.isPolling) return;
    this.isPolling = true;
    this.onTelemetryUpdate = callback;
    this._pollLoop();
  }

  /**
   * Остановка опроса датчиков
   */
  stopPolling() {
    this.isPolling = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  async _pollLoop() {
    if (!this.isPolling) return;

    try {
      const data = await this.readAllSensors();
      if (this.onTelemetryUpdate && this.isPolling) {
        this.onTelemetryUpdate(data);
      }
    } catch (err) {
      console.warn('Ошибка при опросе датчиков:', err);
    }

    if (this.isPolling) {
      this.pollingTimer = setTimeout(() => this._pollLoop(), this.pollingInterval);
    }
  }

  /**
   * Опрос текущих значений датчиков
   */
  async readAllSensors() {
    const telemetry = {
      timestamp: Date.now(),
      rpm: 0,
      speed: 0,
      coolant: 0,
      iat: 0,
      maf: 0,
      throttle: 0,
      load: 0,
      stft: 0,
      ltft: 0,
      fuelLevel: 0,
      voltage: this.batteryVoltage
    };

    // Обороты двигателя (RPM) - PID 010C
    try {
      const resp = await this.elm.sendCommand('010C', 800);
      const val = this._parsePID(resp, '010C');
      if (val !== null) telemetry.rpm = val;
    } catch (e) {}

    // Скорость (Speed) - PID 010D
    try {
      const resp = await this.elm.sendCommand('010D', 800);
      const val = this._parsePID(resp, '010D');
      if (val !== null) telemetry.speed = val;
    } catch (e) {}

    // Температура ОЖ (Coolant) - PID 0105
    try {
      const resp = await this.elm.sendCommand('0105', 800);
      const val = this._parsePID(resp, '0105');
      if (val !== null) telemetry.coolant = val;
    } catch (e) {}

    // Расход воздуха (MAF) - PID 0110
    try {
      const resp = await this.elm.sendCommand('0110', 800);
      const val = this._parsePID(resp, '0110');
      if (val !== null) telemetry.maf = val;
    } catch (e) {}

    // Положение дросселя (Throttle) - PID 0111
    try {
      const resp = await this.elm.sendCommand('0111', 800);
      const val = this._parsePID(resp, '0111');
      if (val !== null) telemetry.throttle = val;
    } catch (e) {}

    // Нагрузка на двигатель (Load) - PID 0104
    try {
      const resp = await this.elm.sendCommand('0104', 800);
      const val = this._parsePID(resp, '0104');
      if (val !== null) telemetry.load = val;
    } catch (e) {}

    // Температура воздуха во впуске (IAT) - PID 010F
    try {
      const resp = await this.elm.sendCommand('010F', 800);
      const val = this._parsePID(resp, '010F');
      if (val !== null) telemetry.iat = val;
    } catch (e) {}

    // Топливные коррекции STFT / LTFT - PID 0106 / 0107
    try {
      const sResp = await this.elm.sendCommand('0106', 800);
      const sVal = this._parsePID(sResp, '0106');
      if (sVal !== null) telemetry.stft = sVal;

      const lResp = await this.elm.sendCommand('0107', 800);
      const lVal = this._parsePID(lResp, '0107');
      if (lVal !== null) telemetry.ltft = lVal;
    } catch (e) {}

    // Уровень топлива - PID 012F
    try {
      const resp = await this.elm.sendCommand('012F', 800);
      const val = this._parsePID(resp, '012F');
      if (val !== null) telemetry.fuelLevel = val;
    } catch (e) {}

    // Напряжение аккумулятора (AT RV)
    try {
      const rv = await this.elm.sendCommand('AT RV', 800);
      const num = parseFloat(rv.replace(/[^0-9.]/g, ''));
      if (!isNaN(num) && num > 5) {
        telemetry.voltage = num.toFixed(1) + 'V';
        this.batteryVoltage = telemetry.voltage;
      }
    } catch (e) {}

    return telemetry;
  }

  /**
   * Сканирование всех ошибок (Confirmed Mode 03, Pending Mode 07, Permanent Mode 0A)
   * С поддержкой выбора конкретных блоков Mazda (PCM, TCM, ABS, EPS, IC)
   * @param {string} moduleHeader - CAN ID блока (например '7E0' для двигателя)
   */
  async scanDiagnosticCodes(moduleHeader = '7E0') {
    const dtcList = [];
    const seenCodes = new Set();

    try {
      // Временно останавливаем полинг датчиков
      const wasPolling = this.isPolling;
      if (wasPolling) this.stopPolling();

      // Устанавливаем адрес заголовка блока
      if (moduleHeader && moduleHeader !== 'AUTO') {
        await this.elm.sendCommand(`AT SH ${moduleHeader}`);
      }

      // 1. Читаем подтвержденные коды (Mode 03)
      const resp03 = await this.elm.sendCommand('03', 3500);
      const codes03 = this._extractCodesFromResponse(resp03, 'Confirmed');
      for (const c of codes03) {
        if (!seenCodes.has(c.code)) {
          seenCodes.add(c.code);
          dtcList.push(c);
        }
      }

      // 2. Читаем ожидающие коды (Mode 07 - Pending)
      const resp07 = await this.elm.sendCommand('07', 3500);
      const codes07 = this._extractCodesFromResponse(resp07, 'Pending');
      for (const c of codes07) {
        if (!seenCodes.has(c.code)) {
          seenCodes.add(c.code);
          dtcList.push(c);
        }
      }

      // 3. Читаем постоянные коды (Mode 0A - Permanent)
      try {
        const resp0A = await this.elm.sendCommand('0A', 3500);
        const codes0A = this._extractCodesFromResponse(resp0A, 'Permanent');
        for (const c of codes0A) {
          if (!seenCodes.has(c.code)) {
            seenCodes.add(c.code);
            dtcList.push(c);
          }
        }
      } catch (e) {}

      // Возвращаем стандартный заголовок
      if (moduleHeader && moduleHeader !== 'AUTO') {
        await this.elm.sendCommand('AT SH 7E0');
      }

      if (wasPolling) this.startPolling(this.onTelemetryUpdate);
    } catch (err) {
      console.error('Ошибка при чтении DTC:', err);
      throw err;
    }

    return dtcList;
  }

  /**
   * Сброс всех диагностических ошибок (Mode 04)
   */
  async clearDiagnosticCodes() {
    const wasPolling = this.isPolling;
    if (wasPolling) this.stopPolling();

    try {
      const resp = await this.elm.sendCommand('04', 4000);
      const isOk = resp.includes('44') || resp.includes('OK');
      if (wasPolling) this.startPolling(this.onTelemetryUpdate);
      return isOk;
    } catch (e) {
      if (wasPolling) this.startPolling(this.onTelemetryUpdate);
      throw e;
    }
  }

  /**
   * Парсинг шестнадцатеричных ответов на DTC (Mode 03, 07, 0A)
   */
  _extractCodesFromResponse(response, statusType = 'Confirmed') {
    const results = [];
    if (!response || response.includes('NO DATA') || response.includes('UNABLE TO CONNECT')) {
      return results;
    }

    // Удаляем лишние пробелы, заголовки и переносы строк
    // Пример ответа: "43 04 21 21 87 00 00" или "4304212187"
    const clean = response.replace(/[^0-9A-Fa-f]/g, '');

    // Ищем маркер ответа: 43 (Mode 03), 47 (Mode 07), 4A (Mode 0A)
    let markerIndex = -1;
    let expectedMarker = '';

    if (clean.includes('43')) {
      markerIndex = clean.indexOf('43');
      expectedMarker = '43';
    } else if (clean.includes('47')) {
      markerIndex = clean.indexOf('47');
      expectedMarker = '47';
    } else if (clean.includes('4A')) {
      markerIndex = clean.indexOf('4A');
      expectedMarker = '4A';
    }

    if (markerIndex === -1) return results;

    const dataPayload = clean.substring(markerIndex + 2);

    // Каждые 4 hex-символа (2 байта) представляют собой 1 код DTC
    for (let i = 0; i < dataPayload.length; i += 4) {
      const byteHex = dataPayload.substring(i, i + 4);
      if (byteHex.length < 4) break;
      if (byteHex === '0000') continue; // Пустой заполнитель

      const codeStr = this._decodeHexToDtc(byteHex);
      if (codeStr && codeStr !== 'P0000') {
        const decodedInfo = decodeDtc(codeStr);
        results.push({
          ...decodedInfo,
          status: statusType,
          hex: byteHex
        });
      }
    }

    return results;
  }

  /**
   * Преобразование 2 байт HEX в формат кода OBD-II (P0123, C0031, etc.)
   */
  _decodeHexToDtc(hex4) {
    const b1 = parseInt(hex4.substring(0, 2), 16);
    const b2 = parseInt(hex4.substring(2, 4), 16);

    const typeBits = (b1 >> 6) & 0x03;
    let prefix = 'P';
    if (typeBits === 1) prefix = 'C';
    else if (typeBits === 2) prefix = 'B';
    else if (typeBits === 3) prefix = 'U';

    const secondDigit = (b1 >> 4) & 0x03;
    const thirdDigit = b1 & 0x0F;
    const fourthFifth = b2.toString(16).padStart(2, '0').toUpperCase();

    return `${prefix}${secondDigit}${thirdDigit.toString(16).toUpperCase()}${fourthFifth}`;
  }

  /**
   * Парсер стандартных Mode 01 PIDs
   */
  _parsePID(response, pid) {
    if (!response || response.includes('NO DATA') || response.includes('ERROR')) return null;

    // Очищаем от пробелов
    const clean = response.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const pidHex = pid.replace(/^01/, '');
    const prefix = '41' + pidHex;

    const idx = clean.indexOf(prefix);
    if (idx === -1) return null;

    const bytesStr = clean.substring(idx + prefix.length);

    const getByte = (byteIndex) => {
      const start = byteIndex * 2;
      return parseInt(bytesStr.substring(start, start + 2), 16);
    };

    const A = getByte(0);
    const B = getByte(1);

    if (isNaN(A)) return null;

    switch (pid) {
      case '010C': // Обороты: ((A * 256) + B) / 4
        if (isNaN(B)) return null;
        return Math.round(((A * 256) + B) / 4);

      case '010D': // Скорость (км/ч): A
        return A;

      case '0105': // Температура ОЖ (°C): A - 40
        return A - 40;

      case '010F': // Температура воздуха во впуске (°C): A - 40
        return A - 40;

      case '0110': // Расход воздуха MAF (г/с): ((A * 256) + B) / 100
        if (isNaN(B)) return null;
        return parseFloat((((A * 256) + B) / 100).toFixed(2));

      case '0111': // Дроссель (%): A * 100 / 255
        return parseFloat(((A * 100) / 255).toFixed(1));

      case '0104': // Нагрузка на двигатель (%): A * 100 / 255
        return parseFloat(((A * 100) / 255).toFixed(1));

      case '0106': // STFT (%): (A - 128) * 100 / 128
        return parseFloat((((A - 128) * 100) / 128).toFixed(1));

      case '0107': // LTFT (%): (A - 128) * 100 / 128
        return parseFloat((((A - 128) * 100) / 128).toFixed(1));

      case '012F': // Уровень топлива (%): A * 100 / 255
        return parseFloat(((A * 100) / 255).toFixed(0));

      default:
        return A;
    }
  }

  _parseSupportedPids(resp) {
    const clean = resp.replace(/[^0-9A-Fa-f]/g, '');
    const idx = clean.indexOf('4100');
    if (idx !== -1) {
      const hex = clean.substring(idx + 4, idx + 12);
      // Битовая маска поддерживаемых PIDs
      const mask = parseInt(hex, 16);
      for (let i = 1; i <= 32; i++) {
        if ((mask & (1 << (32 - i))) !== 0) {
          const pid = '01' + i.toString(16).padStart(2, '0').toUpperCase();
          this.supportedPids.add(pid);
        }
      }
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
