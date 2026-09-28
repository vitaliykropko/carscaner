/**
 * Mazda 6 GH OBD-II Scanner - Main Application Controller
 */

import { Elm327Driver, isIos } from './elm327.js';
import { ObdEngine } from './obd.js';
import { GaugeRenderer, LiveChartRecorder } from './gauges.js';
import { TelemetryLogger } from './logger.js';
import { CanSniffer } from './can_sniffer.js';

class Mazda6ScannerApp {
  constructor() {
    this.elm = new Elm327Driver();
    this.obd = new ObdEngine(this.elm);
    this.logger = new TelemetryLogger();
    this.canSniffer = new CanSniffer(this.elm);
    this.deltaCount = 0;

    this.chart = null;
    this.speedCanvas = null;
    this.rpmCanvas = null;
    this.deferredInstallPrompt = null;
    this.currentDtcResults = [];
    this.lastTelemetry = { speed: 0, rpm: 0 };

    this.init();
  }

  async init() {
    this._initDomReferences();
    this._initPwa();
    this._initGaugesAndCharts();
    this._bindEvents();
    this._setupDriverListeners();
    this._setupCanSnifferListeners();
    this._startGaugeAnimationLoop();
  }

  _initDomReferences() {
    // Header & Status
    this.statusBadge = document.getElementById('statusBadge');
    this.statusText = document.getElementById('statusText');
    this.voltageBadge = document.getElementById('voltageBadge');
    this.voltageText = document.getElementById('voltageText');
    this.connectBtn = document.getElementById('connectBtn');
    this.disconnectBtn = document.getElementById('disconnectBtn');
    this.pwaInstallBtn = document.getElementById('pwaInstallBtn');

    // Navigation & Views
    this.navTabs = document.querySelectorAll('.nav-tab');
    this.views = document.querySelectorAll('.view-section');
    this.dtcBadgeCount = document.getElementById('dtcBadgeCount');
    this.recDot = document.getElementById('recDot');

    // Gauges & Canvases
    this.speedCanvas = document.getElementById('speedGauge');
    this.rpmCanvas = document.getElementById('rpmGauge');
    this.chartCanvas = document.getElementById('liveChart');
    this.chartMetricSelect = document.getElementById('chartMetricSelect');
    this.chartClearBtn = document.getElementById('chartClearBtn');

    // Telemetry fields
    this.valCoolant = document.getElementById('valCoolant');
    this.valMaf = document.getElementById('valMaf');
    this.valThrottle = document.getElementById('valThrottle');
    this.valLoad = document.getElementById('valLoad');
    this.valIat = document.getElementById('valIat');
    this.valStft = document.getElementById('valStft');
    this.valLtft = document.getElementById('valLtft');
    this.valFuel = document.getElementById('valFuel');

    this.barCoolant = document.getElementById('barCoolant');
    this.barMaf = document.getElementById('barMaf');
    this.barThrottle = document.getElementById('barThrottle');
    this.barLoad = document.getElementById('barLoad');
    this.barIat = document.getElementById('barIat');
    this.barStft = document.getElementById('barStft');
    this.barLtft = document.getElementById('barLtft');
    this.barFuel = document.getElementById('barFuel');

    // Diagnostics (DTC)
    this.moduleSelect = document.getElementById('moduleSelect');
    this.scanDtcBtn = document.getElementById('scanDtcBtn');
    this.clearDtcBtn = document.getElementById('clearDtcBtn');
    this.exportDtcBtn = document.getElementById('exportDtcBtn');
    this.dtcList = document.getElementById('dtcList');

    // Logger
    this.logStatusText = document.getElementById('logStatusText');
    this.logCount = document.getElementById('logCount');
    this.toggleRecordBtn = document.getElementById('toggleRecordBtn');
    this.exportCsvBtn = document.getElementById('exportCsvBtn');
    this.exportJsonBtn = document.getElementById('exportJsonBtn');
    this.clearLogBtn = document.getElementById('clearLogBtn');
    this.telemetryTableBody = document.getElementById('telemetryTableBody');

    // Terminal
    this.terminalLogs = document.getElementById('terminalLogs');
    this.terminalForm = document.getElementById('terminalForm');
    this.terminalInput = document.getElementById('terminalInput');
    this.clearTerminalBtn = document.getElementById('clearTerminalBtn');

    // CAN Sniffer
    this.startCanBtn = document.getElementById('startCanBtn');
    this.stopCanBtn = document.getElementById('stopCanBtn');
    this.setBaselineBtn = document.getElementById('setBaselineBtn');
    this.clearBaselineBtn = document.getElementById('clearBaselineBtn');
    this.canFilterInput = document.getElementById('canFilterInput');
    this.applyCanFilterBtn = document.getElementById('applyCanFilterBtn');
    this.exportCanCsvBtn = document.getElementById('exportCanCsvBtn');
    this.exportCanTrcBtn = document.getElementById('exportCanTrcBtn');
    this.clearCanBtn = document.getElementById('clearCanBtn');

    this.canStatusText = document.getElementById('canStatusText');
    this.canUniqueCount = document.getElementById('canUniqueCount');
    this.canTotalCount = document.getElementById('canTotalCount');
    this.canBaselineStatus = document.getElementById('canBaselineStatus');
    this.canTableBody = document.getElementById('canTableBody');
    this.canDeltaLog = document.getElementById('canDeltaLog');
    this.deltaCountBadge = document.getElementById('deltaCountBadge');

    // Demo CAN controls
    this.canDemoControls = document.getElementById('canDemoControls');
    this.simToggleDriverDoor = document.getElementById('simToggleDriverDoor');
    this.simToggleTrunk = document.getElementById('simToggleTrunk');

    // Modals
    this.connModal = document.getElementById('connModal');
    this.closeModalBtn = document.getElementById('closeModalBtn');
    this.btnConnectSerial = document.getElementById('btnConnectSerial');
    this.btnConnectBle = document.getElementById('btnConnectBle');
    this.btnConnectDemo = document.getElementById('btnConnectDemo');

    this.clearConfirmModal = document.getElementById('clearConfirmModal');
    this.cancelClearBtn = document.getElementById('cancelClearBtn');
    this.confirmClearBtn = document.getElementById('confirmClearBtn');

    // iOS modal
    this.iosModal = document.getElementById('iosModal');
    this.closeIosModalBtn = document.getElementById('closeIosModalBtn');
  }

  _initPwa() {
    // Регистрация Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('PWA ServiceWorker зарегистрирован:', reg.scope))
          .catch(err => console.warn('Ошибка ServiceWorker:', err));
      });
    }

    // Обработка кнопки установки PWA
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      if (this.pwaInstallBtn) {
        this.pwaInstallBtn.style.display = 'inline-flex';
      }
    });

    if (this.pwaInstallBtn) {
      this.pwaInstallBtn.addEventListener('click', async () => {
        if (!this.deferredInstallPrompt) return;
        this.deferredInstallPrompt.prompt();
        const { outcome } = await this.deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          this.pwaInstallBtn.style.display = 'none';
        }
        this.deferredInstallPrompt = null;
      });
    }
  }

  _initGaugesAndCharts() {
    // Инициализация самописца
    if (this.chartCanvas) {
      this.chart = new LiveChartRecorder(this.chartCanvas, 80);
      this.chart.render();
    }

    // Первичная отрисовка циферблатов
    this._renderGauges(0, 0);

    // Обработка ресайза окна для четкости Canvas
    window.addEventListener('resize', () => {
      this._renderGauges(this.lastTelemetry.speed, this.lastTelemetry.rpm);
      if (this.chart) this.chart.render();
    });
  }

  _bindEvents() {
    // Переключение вкладок
    this.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const viewName = tab.dataset.view;
        this._switchView(viewName);
      });
    });

    // Модальное окно подключения
    this.connectBtn.addEventListener('click', () => {
      this.connModal.classList.add('active');
    });

    this.closeModalBtn.addEventListener('click', () => {
      this.connModal.classList.remove('active');
    });

    this.disconnectBtn.addEventListener('click', async () => {
      await this._handleDisconnect();
    });

    // Способы подключения
    this.btnConnectSerial.addEventListener('click', () => this._handleConnect('serial'));
    this.btnConnectBle.addEventListener('click', () => {
      if (isIos() && !('bluetooth' in navigator)) {
        this.connModal.classList.remove('active');
        this.iosModal.classList.add('active');
        return;
      }
      this._handleConnect('bluetooth');
    });
    this.btnConnectDemo.addEventListener('click', () => this._handleConnect('demo'));

    if (this.closeIosModalBtn) {
      this.closeIosModalBtn.addEventListener('click', () => {
        this.iosModal.classList.remove('active');
      });
    }

    // Выбор метрики графика
    this.chartMetricSelect.addEventListener('change', (e) => {
      if (this.chart) {
        this.chart.setMetric(e.target.value);
      }
    });

    this.chartClearBtn.addEventListener('click', () => {
      if (this.chart) this.chart.clear();
    });

    // Диагностика (DTC)
    this.scanDtcBtn.addEventListener('click', () => this._handleScanDtc());

    this.clearDtcBtn.addEventListener('click', () => {
      this.clearConfirmModal.classList.add('active');
    });

    this.cancelClearBtn.addEventListener('click', () => {
      this.clearConfirmModal.classList.remove('active');
    });

    this.confirmClearBtn.addEventListener('click', async () => {
      this.clearConfirmModal.classList.remove('active');
      await this._handleClearDtc();
    });

    this.exportDtcBtn.addEventListener('click', () => {
      TelemetryLogger.exportDtcReport(this.currentDtcResults, {
        protocol: this.obd.protocol,
        voltage: this.obd.batteryVoltage
      });
      this.showToast('Отчет об ошибках успешно сохранен', 'success');
    });

    // Логирование (Flight Recorder)
    this.toggleRecordBtn.addEventListener('click', () => {
      if (this.logger.isRecording) {
        this.logger.stop();
        this.toggleRecordBtn.textContent = '⏺ Начать запись';
        this.toggleRecordBtn.classList.remove('btn-danger');
        this.toggleRecordBtn.classList.add('btn-primary');
        this.logStatusText.textContent = 'Остановлен';
        this.recDot.style.display = 'none';
        this.showToast('Запись телеметрии остановлена', 'info');
      } else {
        this.logger.start();
        this.toggleRecordBtn.textContent = '⏹ Остановить';
        this.toggleRecordBtn.classList.remove('btn-primary');
        this.toggleRecordBtn.classList.add('btn-danger');
        this.logStatusText.textContent = 'Запись идет...';
        this.recDot.style.display = 'inline';
        this.showToast('Идет запись параметров в лог', 'info');
      }
    });

    this.exportCsvBtn.addEventListener('click', () => {
      try {
        this.logger.exportCsv();
        this.showToast('CSV файл экспортирован', 'success');
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    });

    this.exportJsonBtn.addEventListener('click', () => {
      try {
        this.logger.exportJson();
        this.showToast('JSON файл экспортирован', 'success');
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    });

    this.clearLogBtn.addEventListener('click', () => {
      this.logger.clear();
      this.logCount.textContent = '0';
      this.telemetryTableBody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; color: var(--text-dim); padding: 30px;">
            Лог очищен.
          </td>
        </tr>`;
      this.showToast('Буфер логов очищен', 'info');
    });

    this.logger.onRecordAdded = (count, record) => {
      this.logCount.textContent = count;
      this._appendTelemetryTableRow(record);
    };

    // Терминал команд
    this.terminalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cmd = this.terminalInput.value.trim();
      if (!cmd) return;
      this.terminalInput.value = '';

      if (!this.elm.isConnected) {
        this._addTerminalLine('ELM327 не подключен. Сначала выполните подключение.', 'err');
        return;
      }

      try {
        const resp = await this.elm.sendCommand(cmd, 3000);
        // Вывод будет также обработан через onTraffic
      } catch (err) {
        this._addTerminalLine(`Ошибка: ${err.message}`, 'err');
      }
    });

    this.clearTerminalBtn.addEventListener('click', () => {
      this.terminalLogs.innerHTML = '';
    });

    // Быстрые кнопки терминала
    document.querySelectorAll('.quick-commands .chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const cmd = chip.dataset.cmd;
        if (!cmd) return;
        this.terminalInput.value = cmd;
        if (this.elm.isConnected) {
          try {
            await this.elm.sendCommand(cmd, 3000);
          } catch (err) {
            this._addTerminalLine(`Ошибка: ${err.message}`, 'err');
          }
        }
      });
    });

    // CAN Sniffer события
    if (this.startCanBtn) {
      this.startCanBtn.addEventListener('click', () => this._handleStartCan());
      this.stopCanBtn.addEventListener('click', () => this._handleStopCan());
      this.setBaselineBtn.addEventListener('click', () => {
        this.canSniffer.snapshotBaseline();
        this.canBaselineStatus.textContent = `Зафиксировано (${this.canSniffer.framesMap.size} ID)`;
        this.canBaselineStatus.style.color = '#00e676';
        this.clearBaselineBtn.style.display = 'inline-flex';
        this.showToast('Базовое состояние зафиксировано (все двери закрыты)', 'success');
      });
      this.clearBaselineBtn.addEventListener('click', () => {
        this.canSniffer.clearBaseline();
        this.canBaselineStatus.textContent = 'Не задано';
        this.canBaselineStatus.style.color = 'var(--text-muted)';
        this.clearBaselineBtn.style.display = 'none';
        this.showToast('Базовое состояние сброшено', 'info');
      });
      this.applyCanFilterBtn.addEventListener('click', () => {
        if (this.canSniffer.isRunning) {
          this._handleStartCan();
        }
      });
      this.exportCanCsvBtn.addEventListener('click', () => {
        try {
          this.canSniffer.exportLog('csv');
          this.showToast('CAN лог экспортирован в CSV', 'success');
        } catch (e) {
          this.showToast(e.message, 'error');
        }
      });
      this.exportCanTrcBtn.addEventListener('click', () => {
        try {
          this.canSniffer.exportLog('trc');
          this.showToast('CAN лог экспортирован в TRC', 'success');
        } catch (e) {
          this.showToast(e.message, 'error');
        }
      });
      this.clearCanBtn.addEventListener('click', () => {
        this.canSniffer.clearHistory();
        this.deltaCount = 0;
        this.canUniqueCount.textContent = '0';
        this.canTotalCount.textContent = '0';
        this.deltaCountBadge.style.display = 'none';
        this.canTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim); padding: 30px;">Лог очищен.</td></tr>`;
        this.canDeltaLog.innerHTML = `<div style="color: var(--text-dim); text-align: center; padding: 40px 10px;">Журнал очищен.</div>`;
        this.showToast('CAN история очищена', 'info');
      });

      // Интерактивные тесты для режима демо
      this.simToggleDriverDoor.addEventListener('click', () => {
        if (this.elm && this.elm.transport && this.elm.transport.toggleDoor) {
          this.elm.transport.toggleDoor('driver');
          const isOpen = this.elm.transport.doorDriverOpen;
          this.showToast(`Дверь водителя ${isOpen ? 'ОТКРЫТА 🚪' : 'ЗАКРЫТА 🔒'}`, isOpen ? 'error' : 'success');
        }
      });
      this.simToggleTrunk.addEventListener('click', () => {
        if (this.elm && this.elm.transport && this.elm.transport.toggleDoor) {
          this.elm.transport.toggleDoor('trunk');
          const isOpen = this.elm.transport.trunkOpen;
          this.showToast(`Багажник ${isOpen ? 'ОТКРЫТ 🚙' : 'ЗАКРЫТ 🔒'}`, isOpen ? 'error' : 'success');
        }
      });
    }
  }

  _setupDriverListeners() {
    this.elm.onTraffic = (dir, data) => {
      this._addTerminalLine(`${dir}: ${data}`, dir === 'TX' ? 'tx' : 'rx');
    };

    this.elm.onStateChange = (state, details) => {
      this.statusBadge.className = 'status-badge ' + state;

      if (state === 'connecting') {
        this.statusText.textContent = 'Подключение...';
        this.connectBtn.disabled = true;
      } else if (state === 'connected') {
        const typeLabel = details.type === 'serial' ? 'Serial' : details.type === 'bluetooth' ? 'BLE' : 'Демо';
        this.statusText.textContent = `Подключен (${typeLabel})`;
        this.connectBtn.style.display = 'none';
        this.disconnectBtn.style.display = 'inline-flex';
        this.voltageBadge.style.display = 'flex';
        this.showToast(`Успешное подключение к ELM327 (${typeLabel})`, 'success');

        if (details.type === 'demo' && this.canDemoControls) {
          this.canDemoControls.style.display = 'flex';
        } else if (this.canDemoControls) {
          this.canDemoControls.style.display = 'none';
        }
      } else if (state === 'disconnected') {
        this.statusText.textContent = 'Отключен';
        this.connectBtn.style.display = 'inline-flex';
        this.connectBtn.disabled = false;
        this.disconnectBtn.style.display = 'none';
        this.voltageBadge.style.display = 'none';
        if (this.canDemoControls) this.canDemoControls.style.display = 'none';
        this.showToast('Адаптер отключен', 'info');
      } else if (state === 'error') {
        this.statusText.textContent = 'Ошибка';
        this.connectBtn.disabled = false;
        this.showToast(`Ошибка подключения: ${details.error}`, 'error');
      }
    };
  }

  _setupCanSnifferListeners() {
    let lastRenderTime = 0;

    this.canSniffer.onFrameReceived = (item, record) => {
      this.canUniqueCount.textContent = this.canSniffer.framesMap.size;
      this.canTotalCount.textContent = this.canSniffer.history.length;

      // Если в кадре есть изменение
      if (record.changed) {
        this.deltaCount++;
        this.deltaCountBadge.textContent = this.deltaCount;
        this.deltaCountBadge.style.display = 'inline-block';

        const isDoor = record.id === '433' || record.id === '430' || record.id === '4B0';
        const div = document.createElement('div');
        div.className = `delta-item ${isDoor ? 'door-event' : ''}`;

        let doorHint = '';
        if (record.id === '433') {
          doorHint = ' [Сигнал концевиков дверей/багажника!]';
        }

        div.innerHTML = `
          <span class="delta-time">${record.time}</span>
          <span class="delta-id">0x${record.id}</span>
          <span class="delta-desc">${record.desc || 'CAN Frame'}${doorHint}:</span>
          <span style="font-weight: bold; color: #fff;">${record.data}</span>
        `;

        if (this.canDeltaLog.firstElementChild && this.canDeltaLog.firstElementChild.innerText.includes('Здесь будут отображаться')) {
          this.canDeltaLog.innerHTML = '';
        }

        this.canDeltaLog.prepend(div);
        if (this.canDeltaLog.children.length > 150) {
          this.canDeltaLog.removeChild(this.canDeltaLog.lastChild);
        }
      }

      // Троттлинг таблицы (8-10 кадров/с для отзывчивости интерфейса)
      const now = performance.now();
      if (now - lastRenderTime > 110) {
        lastRenderTime = now;
        this._renderCanTable();
      }
    };
  }

  _renderCanTable() {
    const filter = this.canFilterInput.value.trim().toUpperCase();
    const rows = [];

    for (const [id, frame] of this.canSniffer.framesMap.entries()) {
      if (filter && !id.includes(filter)) continue;

      const isChanged = frame.deltaHighlightTime > Date.now();
      const bytesHtml = frame.lastData.map((byte, idx) => {
        const isByteChanged = frame.changedIndices.has(idx) && isChanged;
        const hasBase = frame.baselineData && frame.baselineData[idx] !== undefined;
        return `<span class="can-byte ${isByteChanged ? 'changed' : ''} ${hasBase ? 'has-baseline' : ''}">${byte}</span>`;
      }).join('');

      rows.push(`
        <tr>
          <td class="can-id-cell">0x${id}</td>
          <td>${frame.count}</td>
          <td><div class="can-bytes-wrap">${bytesHtml}</div></td>
          <td style="color: var(--text-muted); font-size: 0.76rem;">${frame.desc || '—'}</td>
        </tr>
      `);
    }

    if (rows.length > 0) {
      this.canTableBody.innerHTML = rows.join('');
    }
  }

  async _handleStartCan() {
    if (!this.elm.isConnected) {
      this.showToast('Сначала подключите ELM327', 'error');
      return;
    }

    // Приостанавливаем OBD опрос датчиков чтобы не конфликтовать с мониторингом CAN
    this.obd.stopPolling();

    const filter = this.canFilterInput.value.trim();
    this.startCanBtn.style.display = 'none';
    this.stopCanBtn.style.display = 'inline-flex';
    this.canStatusText.textContent = 'Перехват активен...';
    this.canStatusText.style.color = '#00e676';

    try {
      await this.canSniffer.start(filter);
      this.showToast(`CAN перехват запущен${filter ? ' (Фильтр: 0x' + filter + ')' : ''}`, 'success');
    } catch (e) {
      this.showToast(`Ошибка CAN: ${e.message}`, 'error');
      this._handleStopCan();
    }
  }

  async _handleStopCan() {
    await this.canSniffer.stop();
    this.startCanBtn.style.display = 'inline-flex';
    this.stopCanBtn.style.display = 'none';
    this.canStatusText.textContent = 'Остановлен';
    this.canStatusText.style.color = 'var(--text-main)';
    this.showToast('CAN перехват остановлен', 'info');

    // Если открыта вкладка приборов, возобновляем OBD опрос
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab && activeTab.dataset.view === 'dashboard' && this.elm.isConnected) {
      this.obd.startPolling((data) => this._onTelemetryReceived(data));
    }
  }

  async _handleConnect(type) {
    this.connModal.classList.remove('active');

    try {
      await this.elm.connect(type);

      // Инициализируем протоколы Mazda 6 GH
      this._addTerminalLine(`Инициализация адаптера для Mazda 6 GH (CAN 11/500)...`, 'info');
      const info = await this.obd.initialize();
      this._addTerminalLine(`Протокол: ${info.protocol}, Напряжение: ${info.voltage}`, 'info');

      if (info.voltage) {
        this.voltageText.textContent = info.voltage;
      }

      // Запускаем непрерывный опрос телеметрии для приборной панели
      this.obd.startPolling((data) => this._onTelemetryReceived(data));

    } catch (err) {
      console.error('Ошибка соединения:', err);
      // State change уже покажет ошибку
    }
  }

  async _handleDisconnect() {
    this.obd.stopPolling();
    await this.elm.disconnect();
    this.lastTelemetry = { speed: 0, rpm: 0 };
    this._renderGauges(0, 0);
  }

  _onTelemetryReceived(data) {
    this.lastTelemetry = data;

    // Цифровые параметры
    if (this.valCoolant) this.valCoolant.textContent = data.coolant;
    if (this.valMaf) this.valMaf.textContent = data.maf;
    if (this.valThrottle) this.valThrottle.textContent = data.throttle;
    if (this.valLoad) this.valLoad.textContent = data.load;
    if (this.valIat) this.valIat.textContent = data.iat;
    if (this.valStft) this.valStft.textContent = (data.stft > 0 ? '+' : '') + data.stft;
    if (this.valLtft) this.valLtft.textContent = (data.ltft > 0 ? '+' : '') + data.ltft;
    if (this.valFuel) this.valFuel.textContent = data.fuelLevel;

    // Прогресс бары
    if (this.barCoolant) this.barCoolant.style.width = Math.min(100, Math.max(0, (data.coolant / 120) * 100)) + '%';
    if (this.barMaf) this.barMaf.style.width = Math.min(100, Math.max(0, (data.maf / 35) * 100)) + '%';
    if (this.barThrottle) this.barThrottle.style.width = Math.min(100, Math.max(0, data.throttle)) + '%';
    if (this.barLoad) this.barLoad.style.width = Math.min(100, Math.max(0, data.load)) + '%';
    if (this.barIat) this.barIat.style.width = Math.min(100, Math.max(0, ((data.iat + 20) / 80) * 100)) + '%';
    if (this.barStft) this.barStft.style.width = Math.min(100, Math.max(0, ((data.stft + 25) / 50) * 100)) + '%';
    if (this.barLtft) this.barLtft.style.width = Math.min(100, Math.max(0, ((data.ltft + 25) / 50) * 100)) + '%';
    if (this.barFuel) this.barFuel.style.width = Math.min(100, Math.max(0, data.fuelLevel)) + '%';

    if (data.voltage) {
      this.voltageText.textContent = data.voltage;
    }

    // Передаем значение в график
    if (this.chart) {
      const metric = this.chartMetricSelect.value;
      const chartVal = data[metric] !== undefined ? data[metric] : data.rpm;
      this.chart.addPoint(chartVal);
    }

    // Пишем в логгер, если активна запись
    this.logger.addRecord(data);
  }

  _startGaugeAnimationLoop() {
    let currentSpeed = 0;
    let currentRpm = 0;

    const animate = () => {
      const targetSpeed = this.lastTelemetry.speed || 0;
      const targetRpm = this.lastTelemetry.rpm || 0;

      // Плавная интерполяция стрелок
      currentSpeed += (targetSpeed - currentSpeed) * 0.2;
      currentRpm += (targetRpm - currentRpm) * 0.2;

      this._renderGauges(currentSpeed, currentRpm);

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  _renderGauges(speed, rpm) {
    if (this.speedCanvas) {
      GaugeRenderer.drawCircularGauge(this.speedCanvas, speed, 0, 240, {
        unit: 'КМ/Ч',
        ticks: 12,
        primaryColor: '#0088ff',
        accentColor: '#00d2ff'
      });
    }

    if (this.rpmCanvas) {
      GaugeRenderer.drawCircularGauge(this.rpmCanvas, rpm, 0, 8000, {
        unit: 'ОБ/МИН',
        ticks: 8,
        redline: 6500,
        formatTick: (val) => `${val / 1000}`,
        primaryColor: '#ff4d5a',
        accentColor: '#c40e22'
      });
    }
  }

  async _handleScanDtc() {
    if (!this.elm.isConnected) {
      this.showToast('Сначала подключите ELM327 к автомобилю', 'error');
      return;
    }

    const selectedModule = this.moduleSelect.value;
    this.scanDtcBtn.disabled = true;
    this.scanDtcBtn.textContent = '⏳ Сканирование...';

    this.dtcList.innerHTML = `
      <div class="dtc-empty">
        <div class="dtc-empty-icon" style="animation: pulse 1s infinite alternate;">🔍</div>
        <h3>Опрос блоков управления Mazda 6 GH...</h3>
        <p style="color: var(--text-muted); margin-top: 6px;">Отправка запросов Mode 03, 07 и 0A по шине HS-CAN.</p>
      </div>`;

    try {
      const codes = await this.obd.scanDiagnosticCodes(selectedModule);
      this.currentDtcResults = codes;
      this._renderDtcResults(codes);

      this.dtcBadgeCount.textContent = codes.length;
      this.dtcBadgeCount.style.display = codes.length > 0 ? 'inline-block' : 'none';

      this.showToast(`Сканирование завершено. Найдено ошибок: ${codes.length}`, codes.length > 0 ? 'error' : 'success');
    } catch (err) {
      this.dtcList.innerHTML = `
        <div class="dtc-empty">
          <div class="dtc-empty-icon">⚠️</div>
          <h3 style="color: #ff4d5a;">Ошибка при чтении кодов</h3>
          <p style="color: var(--text-muted); margin-top: 6px;">${err.message}</p>
        </div>`;
      this.showToast('Не удалось прочитать коды ошибок', 'error');
    } finally {
      this.scanDtcBtn.disabled = false;
      this.scanDtcBtn.textContent = '🔍 Сканировать ошибки';
    }
  }

  _renderDtcResults(codes) {
    if (!codes || codes.length === 0) {
      this.dtcList.innerHTML = `
        <div class="dtc-empty">
          <div class="dtc-empty-icon" style="color: #00e676;">✅</div>
          <h3 style="color: #00e676;">Ошибок не обнаружено!</h3>
          <p style="color: var(--text-muted); margin-top: 6px;">
            В выбранном блоке памяти нет активных и сохраненных кодов неисправностей. Все параметры в норме.
          </p>
        </div>`;
      return;
    }

    this.dtcList.innerHTML = codes.map(dtc => `
      <div class="dtc-item ${dtc.severity || 'warning'}">
        <div class="dtc-item-header">
          <div class="dtc-code-wrap">
            <span class="dtc-code">${dtc.code}</span>
            <span class="dtc-status-badge">${dtc.status === 'Confirmed' ? 'Подтвержденная' : dtc.status === 'Pending' ? 'В ожидании' : 'Постоянная'}</span>
          </div>
          <div class="dtc-module">${dtc.module || 'Блок управления'}</div>
        </div>

        <div class="dtc-title">${dtc.title}</div>

        ${dtc.causes && dtc.causes.length > 0 ? `
          <div class="dtc-causes">
            <div class="dtc-causes-title">Возможные причины:</div>
            <ul class="dtc-causes-list">
              ${dtc.causes.map(c => `<li>${c}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${dtc.hint ? `
          <div class="dtc-hint">
            <strong>Совет по Mazda 6 GH:</strong> ${dtc.hint}
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  async _handleClearDtc() {
    if (!this.elm.isConnected) {
      this.showToast('Сначала подключите ELM327', 'error');
      return;
    }

    try {
      this.clearDtcBtn.disabled = true;
      this.clearDtcBtn.textContent = 'Очистка...';

      const ok = await this.obd.clearDiagnosticCodes();
      if (ok) {
        this.showToast('Команды сброса Mode 04 успешно отправлены!', 'success');
        // Очищаем текущий список
        this.currentDtcResults = [];
        this.dtcBadgeCount.style.display = 'none';
        this._renderDtcResults([]);
      } else {
        this.showToast('Блок не подтвердил сброс. Проверьте зажигание.', 'error');
      }
    } catch (e) {
      this.showToast(`Ошибка сброса: ${e.message}`, 'error');
    } finally {
      this.clearDtcBtn.disabled = false;
      this.clearDtcBtn.textContent = '🧹 Сбросить ошибки (Mode 04)';
    }
  }

  _appendTelemetryTableRow(r) {
    if (this.logger.records.length === 1) {
      this.telemetryTableBody.innerHTML = '';
    }

    const tr = document.createElement('tr');
    const timeShort = r.time.substring(11, 19);
    tr.innerHTML = `
      <td>${timeShort}</td>
      <td>${r.rpm}</td>
      <td>${r.speed}</td>
      <td>${r.coolant}</td>
      <td>${r.maf}</td>
      <td>${r.throttle}%</td>
      <td>${r.load}%</td>
      <td>${r.stft}%</td>
      <td>${r.ltft}%</td>
      <td>${r.voltage}V</td>
    `;

    this.telemetryTableBody.prepend(tr);

    // Ограничиваем DOM-элементы таблицы до 100 строк для производительности
    if (this.telemetryTableBody.children.length > 100) {
      this.telemetryTableBody.removeChild(this.telemetryTableBody.lastChild);
    }
  }

  _switchView(viewName) {
    this.navTabs.forEach(t => t.classList.toggle('active', t.dataset.view === viewName));
    this.views.forEach(v => {
      const isTarget = v.id === `view${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`;
      v.classList.toggle('active', isTarget);
    });

    if (viewName === 'dashboard') {
      this._renderGauges(this.lastTelemetry.speed, this.lastTelemetry.rpm);
      if (this.chart) this.chart.render();
    }
  }

  _addTerminalLine(text, type = 'info') {
    if (!this.terminalLogs) return;
    const div = document.createElement('div');
    div.className = `terminal-line ${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    this.terminalLogs.appendChild(div);
    this.terminalLogs.scrollTop = this.terminalLogs.scrollHeight;
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

// Запуск приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  window.app = new Mazda6ScannerApp();
});
