/**
 * Telemetry Flight Recorder & Diagnostic Session Logger
 * Экспорт данных в CSV (для Excel / MegaLogViewer) и JSON.
 */

export class TelemetryLogger {
  constructor() {
    this.isRecording = false;
    this.records = [];
    this.maxRecords = 20000; // До 20 тыс. записей в памяти
    this.sessionStartTime = null;
    this.onRecordAdded = null;
  }

  start() {
    this.isRecording = true;
    this.sessionStartTime = new Date();
  }

  stop() {
    this.isRecording = false;
  }

  clear() {
    this.records = [];
    this.sessionStartTime = null;
  }

  addRecord(data) {
    if (!this.isRecording) return;

    const record = {
      time: new Date().toISOString(),
      timestamp_ms: Date.now(),
      rpm: data.rpm || 0,
      speed: data.speed || 0,
      coolant: data.coolant || 0,
      iat: data.iat || 0,
      maf: data.maf || 0,
      throttle: data.throttle || 0,
      load: data.load || 0,
      stft: data.stft || 0,
      ltft: data.ltft || 0,
      fuelLevel: data.fuelLevel || 0,
      voltage: data.voltage ? parseFloat(data.voltage) : 0
    };

    this.records.push(record);

    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    if (this.onRecordAdded) {
      this.onRecordAdded(this.records.length, record);
    }
  }

  exportCsv() {
    if (this.records.length === 0) {
      throw new Error('Лог телеметрии пуст');
    }

    const headers = [
      'Timestamp',
      'Time (ms)',
      'RPM (об/мин)',
      'Speed (км/ч)',
      'Coolant Temp (°C)',
      'Intake Temp (°C)',
      'MAF (г/с)',
      'Throttle (%)',
      'Engine Load (%)',
      'STFT (%)',
      'LTFT (%)',
      'Fuel Level (%)',
      'Battery Voltage (V)'
    ];

    const rows = this.records.map(r => [
      `"${r.time}"`,
      r.timestamp_ms,
      r.rpm,
      r.speed,
      r.coolant,
      r.iat,
      r.maf,
      r.throttle,
      r.load,
      r.stft,
      r.ltft,
      r.fuelLevel,
      r.voltage
    ]);

    // Добавляем UTF-8 BOM для корректного открытия в Excel на русском языке
    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\r\n');
    this._downloadFile(csvContent, `mazda6_telemetry_${this._getTimestampSuffix()}.csv`, 'text/csv;charset=utf-8');
  }

  exportJson() {
    if (this.records.length === 0) {
      throw new Error('Лог телеметрии пуст');
    }

    const jsonContent = JSON.stringify({
      vehicle: 'Mazda 6 GH',
      sessionStart: this.sessionStartTime,
      totalPoints: this.records.length,
      data: this.records
    }, null, 2);

    this._downloadFile(jsonContent, `mazda6_telemetry_${this._getTimestampSuffix()}.json`, 'application/json');
  }

  /**
   * Экспорт отчета по найденным ошибкам (DTC)
   */
  static exportDtcReport(dtcList, vehicleInfo = {}) {
    const lines = [];
    lines.push('========================================================');
    lines.push('  ОТЧЕТ ДИАГНОСТИКИ MAZDA 6 GH (OBD-II / CAN SCANNER)   ');
    lines.push('========================================================');
    lines.push(`Дата и время: ${new Date().toLocaleString('ru-RU')}`);
    lines.push(`Автомобиль: Mazda 6 GH (2007-2012)`);
    lines.push(`Протокол: ${vehicleInfo.protocol || 'ISO 15765-4 (CAN 11/500)'}`);
    lines.push(`Бортовое напряжение: ${vehicleInfo.voltage || 'н/д'}`);
    lines.push('--------------------------------------------------------');
    lines.push(`Всего найдено ошибок: ${dtcList.length}`);
    lines.push('========================================================\r\n');

    if (dtcList.length === 0) {
      lines.push('Кодов неисправностей не обнаружено. Все системы в норме.');
    } else {
      dtcList.forEach((dtc, index) => {
        lines.push(`[${index + 1}] КОД: ${dtc.code} (${dtc.status || 'Подтвержденная'})`);
        lines.push(`    Блок: ${dtc.module || 'PCM'}`);
        lines.push(`    Описание: ${dtc.title}`);
        if (dtc.subsystem) {
          lines.push(`    Подсистема: ${dtc.subsystem}`);
        }
        if (dtc.causes && dtc.causes.length > 0) {
          lines.push('    Возможные причины:');
          dtc.causes.forEach(cause => lines.push(`      - ${cause}`));
        }
        if (dtc.hint) {
          lines.push(`    Примечание: ${dtc.hint}`);
        }
        lines.push('');
      });
    }

    const content = lines.join('\r\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mazda6_dtc_report_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  _getTimestampSuffix() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  }
}
