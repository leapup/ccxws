const { EventEmitter } = require("events");
const winston = require("winston");
const SmartWss = require("./smart-wss");
const Watcher = require("./watcher");
/**
 * Single websocket connection client with
 * subscribe and unsubscribe methods. It is also an EventEmitter
 * and broadcasts 'trade' events.
 *
 * Anytime the WSS client connects (such as a reconnect)
 * it run the _onConnected method and will resubscribe.
 */
class BasicTradeClient extends EventEmitter {
  constructor(wssPath, name, consumer) {
    super();
    this.consumer = consumer;
    this._wssPath = wssPath;
    this._name = name;
    this._tickerSubs = new Map();
    this._tradeSubs = new Map();
    this._level2SnapshotSubs = new Map();
    this._level2UpdateSubs = new Map();
    this._level3UpdateSubs = new Map();
    this._wss = undefined;
    this._watcher = new Watcher(this);
    this.hasTickers = false;
    this.hasTrades = true;
    this.hasLevel2Snapshots = false;
    this.hasLevel2Updates = false;
    this.hasLevel3Updates = false;
    this.sendAllUpdates = ['okex3', 'Kraken', 'Gateio'];
  }
  //////////////////////////////////////////////
  close(emitClosed = true) {
    this._watcher.stop();
    if (this._wss) {
      this._wss.close();
      this._wss = undefined;
    }
    if (emitClosed) this.emit("closed");
  }
  reconnect() {
    this.close(false);
    this._connect();
    this.emit('reconnected');
    this.consumer.reconnected(this._name.toLowerCase());
  }
  subscribeTicker(market) {
    if (!this.hasTickers) return;
    return this._subscribe(
      market,
      this._tickerSubs,
      "subscribing to ticker",
      this._sendSubTicker.bind(this)
    );
  }
  unsubscribeTicker(market) {
    if (!this.hasTickers) return;
    this._unsubscribe(
      market,
      this._tickerSubs,
      "unsubscribing from ticker",
      this._sendUnsubTicker.bind(this)
    );
  }
  subscribeTrades(market) {
    if (!this.hasTrades) return;
    return this._subscribe(
      market,
      this._tradeSubs,
      "subscribing to trades",
      this._sendSubTrades.bind(this)
    );
  }
  unsubscribeTrades(market) {
    if (!this.hasTrades) return;
    this._unsubscribe(
      market,
      this._tradeSubs,
      "unsubscribing from trades",
      this._sendUnsubTrades.bind(this)
    );
  }
  subscribeLevel2Snapshots(market) {
    if (!this.hasLevel2Snapshots) return;
    return this._subscribe(
      market,
      this._level2SnapshotSubs,
      "subscribing to level 2 snapshots",
      this._sendSubLevel2Snapshots.bind(this)
    );
  }
  unsubscribeLevel2Snapshots(market) {
    if (!this.hasLevel2Snapshots) return;
    this._unsubscribe(
      market,
      this._level2SnapshotSubs,
      "unsubscribing from level 2 snapshots",
      this._sendUnsubLevel2Snapshots.bind(this)
    );
  }
  subscribeLevel2Updates(market) {
    if (!this.hasLevel2Updates) return;
    return this._subscribe(
      market,
      this._level2UpdateSubs,
      "subscribing to level 2 updates",
      this._sendSubLevel2Updates.bind(this)
    );
  }
  unsubscribeLevel2Updates(market) {
    if (!this.hasLevel2Updates) return;
    this._unsubscribe(
      market,
      this._level2UpdateSubs,
      "unsubscribing to level 2 updates",
      this._sendUnsubLevel2Updates.bind(this)
    );
  }
  subscribeLevel3Updates(market) {
    if (!this.hasLevel3Updates) return;
    return this._subscribe(
      market,
      this._level3UpdateSubs,
      "subscribing to level 3 updates",
      this._sendSubLevel3Updates.bind(this)
    );
  }
  unsubscribeLevel3Updates(market) {
    if (!this.hasLevel3Updates) return;
    this._unsubscribe(
      market,
      this._level3UpdateSubs,
      "unsubscribing from level 3 updates",
      this._sendUnsubLevel3Updates.bind(this)
    );
  }
  ////////////////////////////////////////////
  // PROTECTED
  /**
   * Helper function for performing a subscription operation
   * where a subscription map is maintained and the message
   * send operation is performed
   * @param {Market} market
   * @param {Map}} map
   * @param {String} msg
   * @param {Function} sendFn
   * @returns {Boolean} returns true when a new subscription event occurs
   */
  _subscribe(market, map, msg, sendFn) {
    this._connect();
    if (!Array.isArray(market)) {
      let remote_id = market.id;
      if (!map.has(remote_id)) {
        // winston.info(msg, this._name, remote_id);
        map.set(remote_id, market);
        // perform the subscription if we're connected
        // and if not, then we'll reply on the _onConnected event
        // to send the signal to our server!
        if (this._wss.isConnected) {
          sendFn(remote_id);
        }
        return true;
      }
    } else {
      const remoteIdsArray = [];
      market.forEach(currMarket => {
        let remote_id = currMarket.id;
        remoteIdsArray.push(currMarket.id);
        if (!map.has(remote_id)) {
          // winston.info(msg, this._name, remote_id);
          map.set(remote_id, currMarket);
          // perform the subscription if we're connected
          // and if not, then we'll reply on the _onConnected event
          // to send the signal to our server!
        }
      });
      if (this._wss.isConnected) {
        sendFn(remoteIdsArray);
      }
      return true;
    }
    return false;
  }
  /**
   * Helper function for performing an unsubscription operation
   * where a subscription map is maintained and the message
   * send operation is performed
   * @param {Market} market
   * @param {Map}} map
   * @param {String} msg
   * @param {Function} sendFn
   */
  _unsubscribe(market, map, msg, sendFn) {
    let remote_id = market.id;
    if (map.has(remote_id)) {
      let emitMsg = msg ? msg : "unscribing from";
      winston.info(emitMsg, this._name, remote_id);
      map.delete(remote_id);
      if (this._wss.isConnected) {
        sendFn(remote_id);
      }
    }
  }
  /**
   * Idempotent method for creating and initializing
   * a long standing web socket client. This method
   * is only called in the subscribe method. Multiple calls
   * have no effect.
   */
  _connect() {
    if (!this._wss) {
      this._wss = new SmartWss(this._wssPath);
      this._wss.on("open", this._onConnected.bind(this));
      this._wss.on("message", this._onMessage.bind(this));
      this._wss.on("disconnected", this._onDisconnected.bind(this));
      this._wss.connect();
    }
  }
  /**
   * This method is fired anytime the socket is opened, whether
   * the first time, or any subsequent reconnects. This allows
   * the socket to immediate trigger resubscription to relevent
   * feeds
   */
  _onConnected() {
    this.emit('connected');
    this.consumer.connected(this._name.toLowerCase());
    for (let marketSymbol of this._tickerSubs.keys()) {
      this._sendSubTicker(marketSymbol);
    }
    for (let marketSymbol of this._tradeSubs.keys()) {
      this._sendSubTrades(marketSymbol);
    }
    for (let marketSymbol of this._level2SnapshotSubs.keys()) {
      this._sendSubLevel2Snapshots(marketSymbol);
    }
    if (this._level2UpdateSubs.size > 0){
      if (this.sendAllUpdates.includes(this._name)) {
        this._sendSubLevel2Updates([...this._level2UpdateSubs.keys()]);
      } else {
        for (let marketSymbol of this._level2UpdateSubs.keys()) {
          this._sendSubLevel2Updates(marketSymbol);
        }
      }
    }
    for (let marketSymbol of this._level3UpdateSubs.keys()) {
      this._sendSubLevel3Updates(marketSymbol);
    }
    this._watcher.start();
  }
  /**
   * Handles a disconnection event
   */
  _onDisconnected() {
    this._watcher.stop();
    this.emit('disconnected');
    this.consumer.disconnected(this._name.toLowerCase());
  }
  ////////////////////////////////////////////
  // ABSTRACT
  /* istanbul ignore next */
  _onMessage() {
    throw new Error("not implemented");
  }
  /* istanbul ignore next */
  _sendSubTicker() {
    throw new Error("not implemented");
  }
  /* istanbul ignore next */
  _sendUnsubTicker() {
    throw new Error("not implemented");
  }
  /* istanbul ignore next */
  _sendSubTrades() {
    throw new Error("not implemented");
  }
  /* istanbul ignore next */
  _sendUnsubTrades() {
    throw new Error("not implemented");
  }
  /* istanbul ignore next */
  _sendSubLevel2Snapshots() {
    throw new Error("not implemented");
  }
  /* istanbul ignore next */
  _sendSubLevel2Updates() {
    throw new Error("not implemented");
  }
  /* istanbul ignore next */
  _sendSubLevel3Updates() {
    throw new Error("not implemented");
  }
}
module.exports = BasicTradeClient;
