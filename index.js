'use strict';

const http = require('http');
const urllib = require('url');

let Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    homebridge.registerAccessory('homebridge-shelly-shutter', 'shelly-shutter', ShellyShutter);
};

class ShellyShutter {
    constructor(log, config) {
        this.services = [];
        this.log = log;
        this.name = config.name;
        this.ip = config.ip;
        this.current_status = null;
        this.status_callbacks = [];
        this.current_status_time = null;
        this.status_timer = null;
        this.previous_position = null;
        this.target_position = null;
        this.calibration = null;
        this.notification_port = config.notification_port || null;
        this.authentication = config.authentication || null;

        if (config.calibration && config.calibration['touch-down-position']) {
            const touchDown = config.calibration['touch-down-position'];
            if (touchDown > 0 && touchDown < 100) {
                this.log.debug('setting up calibration');
                this.calibration = { touchDown: touchDown };
            }
        }

        if (!this.ip) {
            throw new Error('You must provide an ip address of the switch.');
        }

        if (this.notification_port) {
            this.log.debug(`Starting status notification server at port ${this.notification_port}`);
            this.notification_server = http.createServer((req, res) => {
                this.log.debug(`Handling notification payload`);
                this.serverHandler(req, res);
            });
            this.notification_server.listen(this.notification_port, () => {
                this.log.debug(`Started status notification server at port ${this.notification_port}`);
            });
        }

        // HOMEKIT SERVICES
        this.serviceInfo = new Service.AccessoryInformation();
        this.serviceInfo
            .setCharacteristic(Characteristic.Manufacturer, 'Allterco Robotics Ltd.')
            .setCharacteristic(Characteristic.Model, 'Shelly 2.5');
        this.services.push(this.serviceInfo);

        this.shutterService = new Service.WindowCovering(this.name, 'shutter0');
        this.shutterService.getCharacteristic(Characteristic.CurrentPosition)
            .on('get', this.getCurrentPosition.bind(this));
        this.shutterService.getCharacteristic(Characteristic.TargetPosition)
            .on('get', this.getTargetPosition.bind(this))
            .on('set', this.setTargetPosition.bind(this));
        this.shutterService.getCharacteristic(Characteristic.PositionState)
            .on('get', this.getPositionState.bind(this));
        this.shutterService.getCharacteristic(Characteristic.ObstructionDetected)
            .on('get', this.getObstructionDetected.bind(this));
        this.shutterService.getCharacteristic(Characteristic.HoldPosition)
            .on('set', this.setHoldPosition.bind(this));

        this.services.push(this.shutterService);

        this.moveService = new Service.Switch(`Toggle ${this.name}`, 'toggle');
        this.moveService.getCharacteristic(Characteristic.On)
            .on('get', this.checkToggle.bind(this))
            .on('set', this.doToggle.bind(this));
        this.services.push(this.moveService);

        this.updateStatus(true);
    }

    serverHandler(req, res) {
        if (req.url.startsWith('/status')) {
            this.log.debug(`Status update notification received`);
            this.updateStatus(true);
            res.writeHead(200);
            res.end('OK');

            return;
        }

        res.writeHead(404);
        res.end('Not Found');
    }

    checkToggle(callback) {
        var log = this.log;

        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
                return;
            }

            callback(this.current_status.state !== 'stop');
        });
    }

    doToggle(state, callback) {
        var log = this.log;

        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
                return;
            }

            if (!state) {
                const url = 'http://' + this.ip + `/roller/0/?go=stop`;
                log.debug(`url: ${url}`);
                this.sendJSONRequest(url)
                    .then((response) => {
                        this.updateStatus(true);
                        callback();
                    })
                    .catch((e) => {
                        log.error(`Failed to change target position: ${e}`);
                        setTimeout(() => { callback(e); this.updateStatus(true); }, 3000);
                    });
                return;
            }

            const lastDirection = this.current_status.last_direction;

            if (lastDirection === 'open') {
                this.setTargetPosition(0, callback);
            } else {
                this.setTargetPosition(100, callback);
            }
        });
    }

    getServices() {
        return this.services;
    }

    getActualPosition(value) {
        if (!this.calibration || !this.calibration.touchDown) {
            return value;
        }

        if (value === 0) {
            return value;
        }

        const sourceRange = 100.0;
        const targetRange = 100.0 - this.calibration.touchDown;

        const fractionValue = value / sourceRange;
        const rescaledValue = fractionValue * targetRange;
        const offsetValue = rescaledValue + this.calibration.touchDown;
        const newValue = Math.round(Math.max(0, offsetValue));

        this.log.debug(`Calibrated value ${value} - original ${newValue}`);
        return newValue;
    }

    getCalibratedPosition(value) {
        this.log.debug(`getting calibrated position for ${value}`);
        if (!this.calibration || !this.calibration.touchDown) {
            return value;
        }

        if (value === 0) {
            return value;
        }

        const sourceRange = 100.0 - this.calibration.touchDown;
        const targetRange = 100.0;

        const offsetValue = value - this.calibration.touchDown;
        const fractionValue = offsetValue / sourceRange;
        const rescaledValue = fractionValue * targetRange;
        const newValue = Math.round(Math.max(1, rescaledValue));

        this.log.debug(`Original value ${value} - calibrated ${newValue}`);
        return newValue;
    }

    setTargetPosition(position, callback) {
        var log = this.log;
        log.debug(`setting target position '${position}'`);

        this.target_position = position;

        const url = 'http://' + this.ip + `/roller/0/?go=to_pos&roller_pos=${this.getActualPosition(position)}`;
        log.debug(`url: ${url}`);
        this.sendJSONRequest(url, 'POST')
            .then((response) => {
                this.current_status = response;
                this.current_status_time = Date.now();

                callback();
                this.updateStatus(false);
            })
            .catch((e) => {
                log.error(`Failed to change target position: ${e}`);
                setTimeout(() => { callback(e); this.updateStatus(true); }, 3000);
            });
    }

    setHoldPosition(hold, callback) {
        var log = this.log;
        log.debug(`setting hold position to '${hold}'`);
        if (!hold) {
            callback(null);
            return;
        }

        const url = 'http://' + this.ip + `/roller/0/?go=stop`;
        log.debug(`url: ${url}`);
        this.sendJSONRequest(url)
            .then((response) => {
                this.updateStatus(true);
                callback();
            })
            .catch((e) => {
                log.error(`Failed to change target position: ${e}`);
                setTimeout(() => { callback(e); this.updateStatus(true); }, 3000);
            });
    }

    getTargetPosition(callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
                return;
            }

            if (!this.target_position) {
                this.target_position = this.getCalibratedPosition(this.current_status.current_pos);
            }

            callback(null, this.target_position);
        });
    }

    getCurrentPosition(callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, this.getCalibratedPosition(this.current_status.current_pos));
        });
    }

    positionState(state) {
        let positionState = null;
        switch (this.current_status.state) {
            case 'stop':
                positionState = Characteristic.PositionState.STOPPED;
                break;
            case 'open':
                positionState = Characteristic.PositionState.INCREASING;
                break;
            case 'close':
                positionState = Characteristic.PositionState.DECREASING;
                break;
            default:
                break;
        }
        this.log.debug(`Position state for ${state} is ${positionState}`);
        return positionState;
    }

    getPositionState(callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, this.positionState(this.current_status.state));
        });
    }

    getObstructionDetected(callback) {
        this.getStatus(false, (error) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, this.current_status.stop_reason === 'obstacle');
        });
    }

    updateStatus(forced = false) {
        this.log.debug('Updating roller status');
        this.getStatus(forced, (err) => {
            if (err) {
                return;
            }

            this.log.debug('Updating characteristics');

            this.shutterService.updateCharacteristic(Characteristic.ObstructionDetected, this.current_status.stop_reason === 'obstacle');

            const positionState = this.positionState(this.current_status.state);

            let currentPosition = this.getCalibratedPosition(this.current_status.current_pos);
            this.log.debug(`Reported current position ${currentPosition}`);

            if (positionState === Characteristic.PositionState.STOPPED) {
                this.log.debug(`Roller is stopped, so setting target position from ${this.target_position} to ${currentPosition}`);
                this.target_position = currentPosition;
                this.previous_position = currentPosition;
            } else {
                const calibratedTarget = this.getCalibratedPosition(this.target_position);
                this.log.debug(`Calibrated target ${calibratedTarget}, current ${currentPosition}`);
                if (calibratedTarget === currentPosition) {
                    this.log.debug('--- Triggered by us');

                    if (this.previous_position) {
                        currentPosition = this.previous_position;
                    } else {
                        switch (positionState) {
                            case Characteristic.PositionState.INCREASING:
                                currentPosition = 0;
                                break;
                            case Characteristic.PositionState.DECREASING:
                                currentPosition = 100;
                                break;
                        }
                    }
                } else {
                    this.log.debug('--- Triggered by external switch');
                    this.targetPosition = this.getActualPosition(currentPosition);

                    switch (positionState) {
                        case Characteristic.PositionState.INCREASING:
                            this.target_position = 100;
                            break;
                        case Characteristic.PositionState.DECREASING:
                            this.target_position = 0;
                            break;
                    }

                }
            }

            if (this.target_position == null) {
                this.target_position = currentPosition;
            }

            this.shutterService.updateCharacteristic(Characteristic.CurrentPosition, currentPosition);
            this.shutterService.updateCharacteristic(Characteristic.TargetPosition, this.target_position);
            this.shutterService.updateCharacteristic(Characteristic.PositionState, positionState);
            this.moveService.updateCharacteristic(Characteristic.On, positionState !== Characteristic.PositionState.STOPPED);

            this.log.debug(`Current is ${currentPosition}, target is ${this.target_position}, position state ${positionState}`);
        });
    }

    updateInterval() {
        if (!this.current_status) {
            return 10000;
        }

        if (this.current_status.state !== 'stop') {
            return 5000; // fast update intervals when the roller is working
        }

        return 10000; // slow update interval for idle states
    }

    clearUpdateTimer() {
        clearTimeout(this.status_timer);
    }

    setupUpdateTimer() {
        if (this.notification_server) { // don't schedule status updates for polling - we have them pushed by the switch
          return;
        }

        this.status_timer = setTimeout(() => { this.updateStatus(true); }, this.updateInterval());
    }

    getStatus(forced, callback) {
        if (this.status_callbacks.length > 0) {
            this.log.debug('Pushing status callback to queue - updating');
            this.status_callbacks.push(callback);
            return;
        }

        const now = Date.now();

        if (!forced && this.current_status !== null &&
            this.current_status_time !== null &&
            (now - this.current_status_time < this.updateInterval())) {
            this.log.debug('Returning cached status');
            callback(null);
            return;
        }

        this.clearUpdateTimer();

        this.log.debug(`Executing update, forced: ${forced}`);
        this.status_callbacks.push(callback);

        this.sendJSONRequest('http://' + this.ip + '/roller/0')
            .then((response) => {
                this.log.debug('Done executing update');
                this.current_status = response;
                this.current_status_time = Date.now();
                const callbacks = this.status_callbacks;
                this.status_callbacks = [];

                this.log.debug(`Calling ${callbacks.length} queued callbacks`);
                callbacks.forEach((element) => {
                    element(null, response);
                });
                this.setupUpdateTimer();
            })
            .catch((e) => {
                this.log.error(`Error parsing current status info: ${e}`);
                const callbacks = this.status_callbacks;
                this.status_callbacks = [];

                callbacks.forEach((element) => {
                    element(e);
                });

                this.setupUpdateTimer();
            });
    }

    sendJSONRequest(url, method = 'GET', payload = null) {
        return new Promise((resolve, reject) => {

            const components = new urllib.URL(url);

            const options = {
                method: method,
                host: components.hostname,
                port: components.port,
                path: components.pathname + (components.search ? components.search : ''),
                protocol: components.protocol,
                headers: { 'Content-Type': 'application/json' }
            };

            if (this.authentication) {
                let credentials = Buffer.from(this.authentication).toString('base64');
                options.headers['Authorization'] = 'Basic ' + credentials;
            }

            const req = http.request(options, (res) => {
                res.setEncoding('utf8');

                let chunks = '';
                res.on('data', (chunk) => { chunks += chunk; });
                res.on('end', () => {
                    try {
                        this.log.debug(`Raw response: ${chunks}`);
                        const parsed = JSON.parse(chunks);
                        resolve(parsed);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (err) => {
                reject(err);
            });

            if (payload) {
                const stringified = JSON.stringify(payload);
                this.log(`sending payload: ${stringified}`);
                req.write(stringified);
            }

            req.end();
        });
    }
}
