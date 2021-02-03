/**
 * @implements { EventTarget }
 * @returns {OKTracker}
 * @constructor
 */
function OKTracker(name) {
    this._name = name;
    this._emitter = new EventTarget();
    this._matchingChanges = [];
    this._accessedPaths = [];
    this._isTracking = true;
    this._listeners = [];
};

OKTracker.prototype.onGet = function (target, property, value) {
    if (!this._isTracking) {
        return;
    }

    this._accessedPaths.push({target, property, value});
}
OKTracker.prototype.onSet = function (target, property, oldValue, newValue) {
    if (this._isTracking) {
        return;
    }

    for (let currAccessPath of this._accessedPaths) {
        if (currAccessPath.target === target &&
            currAccessPath.property === property ||
            currAccessPath.value === target) {
            this._matchingChanges.push({target, property, oldValue, newValue});
        }
    }
}
OKTracker.prototype.start = function () {
    OKProxy.addTracker(this);
    this._isTracking = true;
}
OKTracker.prototype.stop = function () {
    this._isTracking = false;
    if (!this._accessedPaths.length) {
        OKProxy.removeTracker(this);
    }
}
OKTracker.prototype.clear = function () {
    this._accessedPaths = [];
    this._matchingChanges = [];
}
OKTracker.prototype.destroy = function () {
    this.stop();
    this.clear();
    OKProxy.removeTracker(this);
    while (this._listeners.length) {
        let listener = this._listeners.pop();
        this._emitter.removeEventListener(listener.type, listener.listener);
    }
}
OKTracker.prototype.dispatch = function () {
    if (this._matchingChanges.length) {
        let event = new Event('change');
        // Copy the events. Sort to make sure length changes are always last.
        event.changes = this._matchingChanges.slice().sort((a, b) => a.property === 'length' ? 1 : -1);
        this._emitter.dispatchEvent(event);
    }
    this._matchingChanges = [];
}
OKTracker.prototype.addEventListener = function (type, listener, options) {
    this._emitter.addEventListener(type, listener, options);
    this._listeners.push({type, listener});
}
OKTracker.prototype.removeEventListener = function (type, listener, options) {
    this._emitter.removeEventListener(type, listener, options);
    this._listeners.remove({type, listener});
}

const OKProxy = function () {
    throw new Error('OKProxy is a static class and should not be instantiated');
};

OKProxy._accessTrackers = new Set();
OKProxy._changes = [];
OKProxy._targetToProxy = new Map();
OKProxy._isTracking = true;

OKProxy.create = function (target) {
    let proxy = OKProxy.getProxyByTarget(target);
    if (!proxy) {
        proxy = new Proxy(target, {
            get: OKProxy.get.bind(this),
            set: OKProxy.set.bind(this)
        });
    }

    return proxy;
}
OKProxy.get = function (target, prop, receiver) {
    if (prop === '$target') {
        return target;
    }

    let value = target[prop];
    if (value instanceof Object && !value.$target) {
        if (typeof value !== 'function') {
            value = OKProxy.create(value);
            receiver[prop] = value;
        }
    }

    OKProxy.onGet(receiver, prop, value);
    return value;
}
OKProxy.set = function (target, prop, value, receiver) {
    let oldValue = target[prop];

    if (oldValue === value) {
        return true;
    }

    if (oldValue && oldValue.$target) {

    }

    target[prop] = value;
    OKProxy.onSet(receiver, prop, oldValue, value);
    OKProxy.triggerDispatch();

    return true;
}
OKProxy.onGet = function (target, property, value) {
    if (!OKProxy._isTracking) {
        return;
    }

    if (typeof property === 'symbol') {
        return;
    }

    for (let tracker of OKProxy._accessTrackers) {
        tracker.onGet(target, property, value);
    }
}
OKProxy.onSet = function (target, property, oldValue, newValue) {
    if (!OKProxy._isTracking) {
        return;
    }

    for (let tracker of OKProxy._accessTrackers) {
        tracker.onSet(target, property, oldValue, newValue);
    }
}
OKProxy.getProxyByTarget = function (target) {
    return OKProxy._targetToProxy.get(target);
}
OKProxy.addTracker = function (tracker) {
    this._accessTrackers.add(tracker);
}
OKProxy.createTracker = function (name) {
    let tracker = new OKTracker(name);
    return tracker;
}
OKProxy.removeTracker = function (tracker) {
    OKProxy._accessTrackers.delete(tracker);
}
OKProxy.pauseTracking = function () {
    this._isTracking = false;
}
OKProxy.resumeTracking = function () {
    this._isTracking = true;
}
OKProxy.triggerDispatch = function () {
    if (OKProxy._dispatchTimeout) {
        return;
    }

    OKProxy._dispatchTimeout = setTimeout(OKProxy.dispatch, 10);
}
OKProxy.dispatch = function () {
    OKProxy._dispatchTimeout = clearTimeout(OKProxy._dispatchTimeout);
    for (let currTracker of OKProxy._accessTrackers) {
        currTracker.dispatch();
    }
}