'use strict'

import CSVToArray from 'rexPlugins/utils/array/CSVToArray.js'; // use simple csv parser
import InstMem from './InstMem.js';
import CmdHandlers from './commands/CmdHandlers.js';

const EE = Phaser.Events.EventEmitter;
const GetValue = Phaser.Utils.Objects.GetValue;

class CSVScenario extends EE {
    constructor(scene, config) {
        super();

        this.scene = scene;
        this.timer = undefined;
        this.instMem = new InstMem(this);
        this.cmdHandlers = new CmdHandlers(this);
        this.resetFromJSON(config);
        this.boot();
    }

    resetFromJSON(o) {
        this._inRunCmdLoop = false;
        this.isRunning = GetValue(o, 'state', false);
        this.isPaused = GetValue(o, 'pause', false);
        this.waitEvent = GetValue(o, 'wait', undefined);
        this.scope = GetValue(o, 'scope', undefined);
        this.timeUnit = GetValue(o, 'timeUnit', 0);
        this.cmdPrefix = GetValue(o, 'prefix', DEFAULT_PREFIX);
        this.argsConvert = GetValue(o, 'argsConvert', true);
        this.argsConvertScope = GetValue(o, 'argsConvertScope', undefined);
        this.cmdHandlers.resetFromJSON(GetValue(o, 'handlers', undefined));
        this.instMem.resetFromJSON(GetValue(o, 'instMem', undefined));
        return this;
    }

    toJSON() {
        return {
            state: this.isRunning,
            pause: this.isPaused,
            wait: this.waitEvent,
            scope: this.scope,
            timeUnit: this.timeUnit,
            prefix: this.cmdPrefix,
            argsConvert: this.argsConvert,
            argsConvertScope: this.argsConvertScope,
            handlers: this.cmdHandlers.toJSON(),
            instMem: this.instMem.toJSON()
        };
    }

    boot() {}

    shutdown() {
        super.shutdown();
        this.clean();
        this.parent = undefined;
    }

    destroy() {
        this.shutdown();
    }

    load(strCmd, scope, config) {
        this.clean();

        this.timeUnit = GetValue(config, 'timeUnit', this.timeUnit);
        if (typeof (this.timeUnit) === 'string') {
            this.timeUnit = TIMEUNITMODE[this.timeUnit];
        }
        this.cmdPrefix = GetValue(config, 'prefix', this.cmdPrefix);
        if (typeof (this.cmdPrefix) === 'string') {
            this.cmdPrefix = new RegExp(this.cmdPrefix);
        }
        this.argsConvert = GetValue(config, 'argsConvert', this.argsConvert);
        this.argsConvertScope = GetValue(config, 'argsConvertScope', this.argsConvertScope);
        this.scope = scope;

        this.append(strCmd);
        return this;
    }

    clean() {
        this.stop();
        this.instMem.resetFromJSON();
        this.cmdHandlers.resetFromJSON();
    }

    start(config) {
        this.stop();
        var label = GetValue(config, 'label', '');
        this.offset = GetValue(config, 'offset', 0);
        if (this.isDebugMode) {
            this.log('Start at Label: ' + label);
        }

        var result = this.goto(label);
        if (!result) {
            return false;
        }

        this.isRunning = true;
        this.runNextCmd();
        return true;
    }

    getIndex(label) {
        var index = this.getCmdHandler('label').getIndex(label);
        if (index == null) {
            this.error('Label: ' + label + ' is not found');
        }
        return index;
    }

    goto(label) {
        var index;
        if (typeof (label) === 'string') {
            index = this.getIndex(label);
        } else {
            index = label;
        }
        if (index == null) {
            return false;
        }
        this.instMem.setNextIndex(index);
        return true;
    }

    wait(eventName) {
        this.waitEvent = eventName;
        if (typeof (eventName) === 'number') {
            var delay = eventName;
            if (this.timeUnit === 1) {
                delay *= 1000;
            }
            this.timer = this.scene.time.delayedCall(delay, this.continue, [eventName], this);
        }
        return this;
    }

    stop() {
        if (!this.isRunning) {
            return this;
        }

        this.isRunning = false;
        this.isPaused = false;

        // clear wait event
        this.waitEvent = undefined;
        if (this.timer) {
            this.timer.remove();
            this.timer = undefined;
        }

        return this;
    }

    complete() {
        this.emit('complete', this);
        this.stop();
        return this;
    }

    append(strCmd) {
        this.parse(CSVToArray(strCmd));
        return this;
    }

    pause() {
        if (!this.isRunning) {
            return this;
        }
        if (this.isPaused) {
            return this;
        }

        this.isPaused = true;
        if (this.timer) {
            this.timer.paused = true;
        }
        return this;
    }

    resume() {
        if (!this.isRunning) {
            return this;
        }
        if (!this.isPaused) {
            return this;
        }

        this.isPaused = false;
        if (this.timer) {
            this.timer.paused = false;
        }
        return this;
    }

    continue (eventName) {
        if ((!this.isRunning) ||
            this.isPaused ||
            (this.waitEvent === undefined)) {
            return this;
        }

        if (eventName === this.waitEvent) {
            this.timer = undefined;
            this.waitEvent = undefined;
            this.runNextCmd();
        }
        return this;
    }

    get lastLabel() {
        return this.cmdHandlers.labelCmd.lastLabel;
    }

    get previousLabel() {
        return this.cmdHandlers.labelCmd.preLabel;
    }

    getCmdHandler(name) {
        if (typeof (name) !== 'string') {
            name = name[0];
        }
        return this.cmdHandlers.get(name);
    }

    parse(arr) {
        var item, name, prefix = this.cmdPrefix;
        for (var i = 0, len = arr.length; i < len; i++) {
            item = arr[i];
            name = item[0];
            if (name === '-') {
                this.appendCommand(item);

            } else if (!isNaN(name)) {
                var time = parseFloat(name);
                if (time > 0) {
                    // insert 'wait' command
                    this.appendCommand(['wait', time]);
                }
                item[0] = '-';
                this.appendCommand(item);

            } else if (prefix.test(name)) {
                var innerMatch = name.match(prefix);
                item[0] = innerMatch[1].toLowerCase();
                var isValid = this.appendCommand(item);

                if (!isValid) {
                    this.error('Line ' + i + ': ' + JSON.stringify(item) + ' is not a valid command');
                }

            } else {
                // insert 'wait' command
                this.appendCommand(['wait', name]);
                item[0] = '-';
                this.appendCommand(item);
            }
        }

        return this;
    }

    appendCommand(inst) {
        var handler = this.getCmdHandler(inst);
        if (handler == null) {
            return false;
        }
        inst = handler.parse(inst, this.instMem.length);
        if (inst) {
            this.instMem.append(inst);
        }
        return true;
    }

    runNextCmd() {
        if (this._inRunCmdLoop) { // prevent re-entry
            return;
        }

        var threadId = this.threadId;
        var instMem = this.instMem;
        var inst, cmdHandler;
        this._inRunCmdLoop = true;
        while (
            this.isRunning &&
            (!this.isPaused) &&
            (this.waitEvent === undefined)
        ) {
            inst = instMem.get();
            instMem.setNextIndex();
            if (inst == null) {
                this.complete();
                break;
            }
            this.getCmdHandler(inst).run(inst);
        }
        this._inRunCmdLoop = false;
        return this;
    }

    log(msg) {
        this.emit('log', msg, this);
        return this;
    }

    get isDebugMode() {
        return (this.listenerCount('log') > 0);
    }

    error(msg) {
        this.emit('error', msg, this);
        return this;
    }
}

const TIMEUNITMODE = {
    ms: 0,
    s: 1,
    sec: 1
};
const DEFAULT_PREFIX = /^#([a-zA-Z]+)/;

export default CSVScenario;