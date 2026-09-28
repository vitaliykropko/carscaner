/**
 * CAN Bus Sniffer & Delta Analyzer for Mazda 6 GH
 * Позволяет перехватывать и логировать пакеты шины CAN (AT MA / AT CRA),
 * выявлять изменение байтов при открытии/закрытии дверей и багажника.
 */

export class CanSniffer {
  constructor(elmDriver) {
    this.elm = elmDriver;
    this.isRunning = false;
    this.filterId = '';
    this.framesMap = new Map(); // id -> { id, lastData: [], prevData: [], baselineData: [], count: 0, lastSeen: 0, changedIndices: Set }
    this.history = []; // Массив всех записанных кадров
    this.maxHistory = 15000;
    this.hasBaseline = false;
    this.onFrameReceived = null; // (frame, isNewOrChanged) => void
    this.onStatusChange = null;

    // Известные CAN ID на платформе Mazda 6 GH / Mazda 3 / Ford:
    this.knownDescriptions = {
      '433': 'BCM / Двери, багажник, капот (статус концевиков)',
      '430': 'IC / Индикаторы приборной панели (Door Ajar)',
      '201': 'PCM / Обороты, педаль газа, скорость колес',
      '420': 'PCM / Температура ОЖ, одометр, скорость',
      '215': 'ABS-DSC / Датчики вращения колес, тормозное давление',
      '240': 'SAS / Датчик угла поворота рулевого колеса',
      '4B0': 'BCM / Статус замков, ключа зажигания, блокировки',
      '485': 'RCM / Подушки безопасности, датчики удара',
      '511': 'Audio / Управление магнитолой и кнопками руля',
      '720': 'IC (Диагностический заголовок приборной панели)',
      '726': 'BCM (Диагностический заголовок кузовной электроники)',
      '760': 'ABS/DSC (Диагностический заголовок блока курсовой устойчивости)',
      '7E0': 'PCM (Диагностический заголовок двигателя)'
    };
  }

  /**
   * Запуск перехвата шины CAN
   * @param {string} filterId - Опциональный фильтр по CAN ID (например '433')
   */
  async start(filterId = '') {
    if (this.isRunning) return;
    this.filterId = filterId.trim().toUpperCase();

    // Настраиваем адаптер для непрерывного мониторинга CAN
    await this.elm.sendCommand('AT E0'); // Эхо выкл
    await this.elm.sendCommand('AT H1'); // Заголовки ВКЛ (чтобы видеть CAN ID)
    await this.elm.sendCommand('AT S1'); // Пробелы ВКЛ (чтобы байты легко разделялись)
    await this.elm.sendCommand('AT CAF 0'); // Ручное форматирование CAN кадров

    if (this.filterId) {
      // Устанавливаем фильтр приемника ELM327 на конкретный CAN ID
      await this.elm.sendCommand(`AT CRA ${this.filterId}`);
    } else {
      // Принимать все пакеты
      await this.elm.sendCommand('AT AR');
    }

    this.isRunning = true;
    if (this.onStatusChange) this.onStatusChange(true);

    // Подключаемся к потоку данных транспорта
    this._origOnData = this.elm.transport.onData;
    this._lineBuffer = '';

    this.elm.transport.onData = (chunk) => {
      this._handleStreamChunk(chunk);
    };

    // Запускаем команду непрерывного мониторинга: AT MA (Monitor All)
    // Внимание: AT MA не возвращает '>' пока не отправлен любой символ прерывания!
    try {
      await this.elm.transport.write('AT MA\r');
    } catch (e) {
      console.error('Ошибка отправки AT MA:', e);
      this.stop();
    }
  }

  /**
   * Остановка перехвата CAN
   */
  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    try {
      // Прерывание потока AT MA отправкой пробела или перевода строки
      if (this.elm && this.elm.transport) {
        await this.elm.transport.write(' \r');
      }
      await this._delay(150);

      // Восстанавливаем оригинальный обработчик
      if (this.elm && this.elm.transport && this._origOnData) {
        this.elm.transport.onData = this._origOnData;
      }

      // Сбрасываем фильтры и возвращаем стандартный режим
      await this.elm.sendCommand('AT AR');
      await this.elm.sendCommand('AT H0');
      await this.elm.sendCommand('AT S0');
    } catch (e) {
      console.warn('Ошибка при остановке мониторинга CAN:', e);
    }

    if (this.onStatusChange) this.onStatusChange(false);
  }

  /**
   * Зафиксировать текущее состояние как базовое (когда все двери и багажник закрыты)
   */
  snapshotBaseline() {
    this.hasBaseline = true;
    for (const [id, frame] of this.framesMap.entries()) {
      frame.baselineData = [...frame.lastData];
      frame.changedIndices.clear();
    }
  }

  /**
   * Сбросить базовое состояние
   */
  clearBaseline() {
    this.hasBaseline = false;
    for (const frame of this.framesMap.values()) {
      frame.baselineData = [];
      frame.changedIndices.clear();
    }
  }

  /**
   * Очистить историю логов
   */
  clearHistory() {
    this.history = [];
    this.framesMap.clear();
    this.hasBaseline = false;
  }

  _handleStreamChunk(chunk) {
    this._lineBuffer += chunk;
    const lines = this._lineBuffer.split(/[\r\n]+/);
    this._lineBuffer = lines.pop(); // Оставляем незавершенную строку в буфере

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine === '>' || cleanLine.includes('SEARCHING') || cleanLine.includes('STOPPED')) {
        continue;
      }
      this._parseCanLine(cleanLine);
    }
  }

  /**
   * Разбор одной строки кадра CAN
   * Типичный формат при AT H1:
   * "433 8 00 12 00 FF 00 00 00 00"
   * или "433 00 12 00 FF 00 00 00 00"
   */
  _parseCanLine(raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return;

    const canId = parts[0].toUpperCase();
    if (!/^[0-9A-F]{3,8}$/.test(canId)) return; // Не похоже на CAN ID

    let dataBytes = [];
    let dlc = 8;

    // Проверяем, является ли второй элемент длиной DLC
    if (parts.length > 2 && parts[1].length === 1 && !isNaN(parseInt(parts[1], 10))) {
      dlc = parseInt(parts[1], 10);
      dataBytes = parts.slice(2);
    } else {
      dataBytes = parts.slice(1);
      dlc = dataBytes.length;
    }

    const now = Date.now();
    const isNew = !this.framesMap.has(canId);

    if (isNew) {
      this.framesMap.set(canId, {
        id: canId,
        desc: this.knownDescriptions[canId] || '',
        lastData: dataBytes,
        prevData: [],
        baselineData: [],
        count: 1,
        lastSeen: now,
        changedIndices: new Set(),
        deltaHighlightTime: 0
      });
    }

    const item = this.framesMap.get(canId);
    item.count++;
    item.lastSeen = now;

    // Детектор изменений байтов относительно базового или предыдущего состояния
    let hasChanged = false;
    const currentChanged = new Set();

    const compareTarget = this.hasBaseline && item.baselineData.length > 0
      ? item.baselineData
      : item.lastData;

    for (let i = 0; i < dataBytes.length; i++) {
      if (compareTarget[i] !== undefined && compareTarget[i] !== dataBytes[i]) {
        currentChanged.add(i);
        hasChanged = true;
      }
    }

    item.prevData = item.lastData;
    item.lastData = dataBytes;

    if (hasChanged) {
      item.changedIndices = currentChanged;
      item.deltaHighlightTime = now + 1500; // Подсветка активна 1.5 секунды
    }

    // Сохранение в историю логов
    const record = {
      time: new Date().toLocaleTimeString() + '.' + String(now % 1000).padStart(3, '0'),
      timestamp: now,
      id: canId,
      dlc: dlc,
      data: dataBytes.join(' '),
      raw: raw,
      changed: hasChanged,
      desc: item.desc
    };

    this.history.push(record);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    if (this.onFrameReceived) {
      this.onFrameReceived(item, record);
    }
  }

  /**
   * Экспорт перехваченного CAN-лога в CSV или TXT
   */
  exportLog(format = 'csv') {
    if (this.history.length === 0) {
      throw new Error('История CAN пакетов пуста');
    }

    let content = '';
    let fileName = '';
    let mimeType = '';

    if (format === 'csv') {
      const headers = ['Timestamp', 'CAN_ID', 'DLC', 'DATA', 'Description', 'Changed'];
      const rows = this.history.map(h => [
        `"${h.time}"`,
        `"0x${h.id}"`,
        h.dlc,
        `"${h.data}"`,
        `"${h.desc || ''}"`,
        h.changed ? 'YES' : 'NO'
      ]);
      content = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
      fileName = `mazda6_can_bus_log_${Date.now()}.csv`;
      mimeType = 'text/csv;charset=utf-8';
    } else {
      // Формат TRC / TXT
      const lines = [
        '; ========================================================',
        '; MAZDA 6 GH CAN BUS TRACE LOG',
        `; Recorded: ${new Date().toISOString()}`,
        `; Total frames: ${this.history.length}`,
        '; Format: [Time]  [CAN ID]  [DLC]  [Data Bytes]  [Note]',
        '; ========================================================'
      ];
      this.history.forEach(h => {
        lines.push(`${h.time.padEnd(14)} 0x${h.id.padEnd(5)} ${h.dlc}  ${h.data.padEnd(26)} ${h.changed ? ' [DELTA!]' : ''} ${h.desc ? '; ' + h.desc : ''}`);
      });
      content = lines.join('\r\n');
      fileName = `mazda6_can_trace_${Date.now()}.trc`;
      mimeType = 'text/plain;charset=utf-8';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  _delay(ms) {
    return new Promise(res => setTimeout(res, ms));
  }
}
