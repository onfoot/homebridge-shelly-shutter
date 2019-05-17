# homebridge-shelly-shutter

`homebridge-shelly-shutter` is a [Homebridge](https://github.com/nfarina/homebridge) plugin you can use to control your Shelly 2.5 in-wall switch acting as a window shutter.

There is an excellent and comprehensive [homebridge-shelly](https://github.com/alexryd/homebridge-shelly), but it kept reporting the wrong shutter status all the time, and I more prefer simpler and single-purpose plugins, so I decided to quickly roll my own.

## Installation

`npm -g install https://github.com/onfoot/homebridge-shelly-shutter.git`

## Configuration

An entry in `config.json` is needed

```
{
    "accessory": "ShellyShutter",
    "name": "<e.g. Porch>",
    "ip": "<shelly's ip address>"
}
```

## TODO

Not publishing this one on npm just yet, as the internals might change dramatically, or I may just give up and use the `homebridge-shelly` plugin once issues are worked out. If Shelly firmware starts reporting the shutter open state more accurately either through MQTT or CoAP, I might switch to those protocols otherwise, as traditional HTTP polling is not as efficient as receiving the status from the device directly. Currently, while the shutter is moving, it's reporting the open-percentage amount as of the previous stop state, not the current estimated one. But the plugin at least tries to adjust the polling intervals according to current state, so the status seen in Home app is good enough.