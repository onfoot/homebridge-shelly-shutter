# homebridge-shelly-shutter

`homebridge-shelly-shutter` is a [Homebridge](https://github.com/nfarina/homebridge) plugin you can use to control your Shelly 2.5 in-wall switch acting as a window shutter.

There is an excellent and comprehensive [homebridge-shelly](https://github.com/alexryd/homebridge-shelly), but it kept reporting the wrong shutter status all the time, and I more prefer simpler and single-purpose plugins, so I decided to quickly roll my own.

## Installation

`npm -g install homebridge-shelly-shutter`

## Configuration

An entry in `config.json` is needed

```
{
    "accessory": "shelly-shutter",
    "name": "<e.g. Porch>",
    "ip": "<shelly's ip address>"
}
```

If you want a toggle button that moves or stops the shutters, you need an option `move-toggle` of value `true`. When `On`, shutters move in the opposite direction of last movement.

Example:

```
{
    "accessory": "shelly-shutter",
    "name": "<e.g. Porch>",
    "ip": "<shelly's ip address>",
    "move-toggle": true
}
```

If your shelly web interface is restricted with login and password, you need to add a `authentication` option with the value of `<username>:<password>`.

Example for when username and password are "admin" (not recommended!):

```
{
    "accessory": "shelly-shutter",
    "name": "<e.g. Porch>",
    "ip": "<shelly's ip address>",
    "authentication": "admin:admin"
}
```

As of 1.5.6 version of the switch firmware, Shellies 2.5 in shutter mode gained the ability to call action URLs in the event of shutters starting and stopping moving. This frees the plugin from constantly polling the status of the switch, and instead will get pinged on the status update, which improves responsiveness of any HomeKit actions that could be performed, especially when using the physical shutter switch or an automation. For example, if it's dark outside, after I open the shutters on our patio, the patio light is turned on for a few minutes. When I close the shutters, the light turns off.

If you want to set up the notifications, you need to add a `notification_port` option with a specified HTTP port on which the plugin will listen.

Example:

```
{
    "accessory": "shelly-shutter",
    "name": "<e.g. Porch>",
    "ip": "<shelly's ip address>",
    "notification_port": 54200
}
```

The action URLs you need to define in Shelly configuration Actions section (for `ROLLER OPEN URL`, `ROLLER CLOSE URL`, and `ROLLER STOP URL`) shall be `http://<homebridge-host-ip>:<notification_port>/status`, e.g. `http://192.168.0.1:54200/status`.

If you have external window shutters, the issue with Shelly's calibration is that it takes into account only the time between what it reads as closed and open roller states, e.g. when the limit switches in the roller motor get triggered. Also, usually, the closed state doesn't mean the motor stops moving once the shutters touch the ground - they usually roll down some more in order to close the gaps between the shutter blades, and whole weight of the shutters doesn't rest on the motor all the time. To add insult to injury, the shutter motion is not constant across the boundaries - they roll up faster when closer to the open state, because the roll in the cartrige has higher diameter, and the motor has less weight to lift.

Those issues make it difficult to have an ability to open the shades to 50% so they actually reveal half of the window's height. To migitate that partially, there is an experimental option to tweak Shelly's calibration by defining the touch-down point of the shutters, at which, well, they touch the ground when closing and mostly stop moving. This doesn't yet solve the issue of variable rolling speed, it's likely that we can get pretty close by comparing the timing of getting from 0 to touch-down to fully open state, and finding the right curve.

To set the touch-down point, add a `calibration` dictionary with a `touch-down-position` key containing a value between 1 and 99. You have to figure out the value empirically by closing the shades as close to the touch-down point as possible and reading the position percentage either using this plugin or Shelly's web/app UI. I found 15 to be working pretty well in my case.

Example:

```
{
    "accessory": "shelly-shutter",
    "name": "<e.g. Porch>",
    "ip": "<shelly's ip address>",
    "calibration": {
        "touch-down-position": 15
    }
}
```

## TODO

Once Shelly firmware starts reporting the shutter open state more accurately either through MQTT or CoAP, I might switch to those protocols otherwise, as traditional HTTP polling is not as efficient as receiving the status from the device directly. Currently, while the shutter is moving, it's reporting the open-percentage value of the target stop state, not the current estimated one. But the plugin at least tries to adjust the polling intervals according to current state, so the status seen in Home app is good enough.
