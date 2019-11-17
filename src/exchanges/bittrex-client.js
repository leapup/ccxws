const {EventEmitter} = require("events");
const crypto = require("crypto");
const winston = require("winston");
const moment = require("moment");
const cloudscraper = require("cloudscraper");
const signalr = require("signalr-client");
const Watcher = require("../watcher");
const Ticker = require("../ticker");
const Trade = require("../trade");
const Level2Snapshot = require("../level2-snapshot");
const Level2Update = require("../level2-update");
const Level2Point = require("../level2-point");

class BittrexClient extends EventEmitter {
  constructor(params) {
    super();
    this.apiName = 'bittrex';
    this.consumer = params.consumer;
    this._retryTimeoutMs = 15000;
    this._cloudflare; // placeholder for information from cloudflare
    this._tickerSubs = new Map();
    this._tradeSubs = new Map();
    this._level2UpdateSubs = new Map();
    this._watcher = new Watcher(this);
    this._tickerConnected;
    this.prevSeqDict = {};
    this._finalClosing = false;

    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Snapshots = false;
    this.hasLevel2Updates = true;
    this.hasLevel3Snapshots = false;
    this.hasLevel3Updates = false;
    this.messages = [];
    this.snapshots = {};
    this.lostMessages = {};
    this.isRunning = false;
  }

  close(emitEvent = true) {
    if (emitEvent) {
      // if user activated close, we flag this
      // so we don't attempt to reconnect
      this._finalClosing = true;
    }
    this._watcher.stop();
    if (this._wss) {
      try {
        this._wss.end();
      } catch (e) {
        // ignore
      }
      this._wss = undefined;
    }
    if (emitEvent) this.emit("closed");
  }

  reconnect(emitEvent = true) {
    this.close(false);
    this._connect();
    if (emitEvent) {
      this.emit('reconnected');
      this.consumer.reconnected(this.apiName);
    }
  }

  subscribeTicker(market) {
    let remote_id = market.id;
    if (this._tickerSubs.has(remote_id)) return;

    this._connect();
    winston.info("subscribing to ticker", "Bittrex", remote_id);
    this._tickerSubs.set(remote_id, market);
    if (this._wss) {
      this._sendSubTickers(remote_id);
    }
  }

  unsubscribeTicker(market) {
    let remote_id = market.id;
    if (!this._tickerSubs.has(remote_id)) return;
    winston.info("subscribing to ticker", "Bittrex", remote_id);
    this._tickerSubs.delete(remote_id);
    if (this._wss) {
      this._sendUnsubTicker(remote_id);
    }
  }

  subscribeTrades(market) {
    this._subscribe(market, this._tradeSubs, "subscribing to trades");
  }

  subscribeLevel2Updates(market) {
    this._subscribe(market, this._level2UpdateSubs, "subscribing to level2 updates");
  }

  unsubscribeTrades(market) {
    this._unsubscribe(market, this._tradeSubs, "unsubscribing from trades");
  }

  unsubscribeLevel2Updates(market) {
    this._unsubscribe(market, this._level2UpdateSubs, "unsubscribing from level2 updates");
  }

  ////////////////////////////////////
  // PROTECTED

  _resetSubCount() {
    this._subCount = {};
  }

  _subscribe(market, map, msg) {
    this._connect();
    let remote_id = market.id;

    if (!map.has(remote_id)) {
      winston.info(msg, "Bittrex", remote_id);
      map.set(remote_id, market);

      if (this._wss) {
        this._sendSub(remote_id);
      }
    }
  }

  _unsubscribe(market, map, msg) {
    let remote_id = market.id;
    if (map.has(remote_id)) {
      winston.info(msg, "Bittrex", remote_id);
      map.delete(remote_id);

      if (this._wss) {
        this._sendUnsub(remote_id);
      }
    }
  }

  _sendSub(remote_id) {
    // increment market counter
    this._subCount[remote_id] = (this._subCount[remote_id] || 0) + 1;

    // if we have more than one sub, ignore the request as we're already subbed
    if (this._subCount[remote_id] > 1) return;

    // initiate snapshot request
    if (this._level2UpdateSubs.has(remote_id)) {
      this._wss.call("CoreHub", "QueryExchangeState", remote_id).done((err, result) => {
        if (err) return winston.error("snapshot failed", remote_id, err);
        if (!result) return winston.warn("snapshot empty", remote_id);
        this.snapshots[remote_id] = 1;
        if(this.lostMessages[remote_id]) {
          const activeMessages = this.lostMessages[remote_id].filter((msg)=> msg.Nonce > result.Nonce)
          this.messages = this.messages.concat(activeMessages);
          // console.log(`recover ${activeMessages.length} messages from ${remote_id}`);
          delete this.lostMessages[remote_id];
        }
        let market = this._level2UpdateSubs.get(remote_id);
        let snapshot = this._constructLevel2Snapshot(result, market);
        this.emit('l2snapshot');
        this.consumer.handleSnapshot(snapshot);
        // initiate the subscription
      });
      this._wss.call("CoreHub", "SubscribeToExchangeDeltas", remote_id).done(err => {
        if (err) return winston.error("subscribe failed", remote_id, err);
      });
    }else {
      console.log()
    }
  }

  _sendUnsub(remote_id) {
    // decrement market count
    this._subCount[remote_id] -= 1;

    // if we still have subs, then leave channel open
    if (this._subCount[remote_id]) return;

    // otherwise initiate the unsubscription
    this._wss.call("CoreHub", "UnsubscribeToExchangeDeltas", remote_id).done(err => {
      if (err) winston.error("ussubscribe failed", remote_id);
    });
  }

  _sendSubTickers() {
    if (this._tickerConnected) return;
    this._wss.call("CoreHub", "SubscribeToSummaryDeltas").done(err => {
      if (err) winston.error("ticker subscribe failed");
      else this._tickerConnected = true;
    });
  }

  _sendUnsubTicker(remote_id) {
    this._wss.call("CoreHub", "UnsubscribeToSummaryDeltas", remote_id).done(err => {
      if (err) winston.error("ticker unsubscribe failed", remote_id);
    });
  }

  async _connectCloudflare() {
    return new Promise((resolve, reject) => {
      winston.info("cloudflare connection to https://bittrex.com/");
      cloudscraper.get("https://bittrex.com/", (err, res) => {
        if (err) return reject(err);
        else
          resolve({
            cookie: res.request.headers["cookie"] || "",
            user_agent: res.request.headers["User-Agent"] || "",
          });
      });
    });
  }

  async _connect() {
    // ignore wss creation is we already are connected
    if (this._wss) return;

    // connect to cloudflare once and cache the promise
    if (!this._cloudflare) this._cloudflare = this._connectCloudflare();

    // wait for single connection to cloudflare
    let metadata = await this._cloudflare;

    // doublecheck if wss was already created
    if (this._wss) return;

    let wss = (this._wss = new signalr.client(
      "wss://socket.bittrex.com/signalr", // service url
      ["CoreHub"], // hubs
      undefined, // disable reconnection
      true // wait till .start() called
    ));

    wss.headers["User-Agent"] = metadata.user_agent;
    wss.headers["cookie"] = metadata.cookie;

    wss.start();
    wss.serviceHandlers = {
      connected: this._onConnected.bind(this),
      disconnected: this._onDisconnected.bind(this),
      messageReceived: this._onMessage.bind(this),
      onerror: err => winston.error("error", err),
      connectionlost: err => winston.error("connectionlost", err),
      connectfailed: err => winston.error("connectfailed", err),
      reconnecting: () => true, // disables reconnection
    };
  }


  _onConnected() {
    winston.info("connected to wss://socket.bittrex.com/signalr");
    clearTimeout(this._reconnectHandle);
    this.emit('connected');
    this.consumer.connected(this.apiName);
    this._subCount = {};
    this._tickerConnected = false;
    this._watcher.start();
    for (let marketSymbol of this._tickerSubs.keys()) {
      this._sendSubTickers(marketSymbol);
    }
    for (let marketSymbol of this._tradeSubs.keys()) {
      this._sendSub(marketSymbol);
    }
    for (let marketSymbol of this._level2UpdateSubs.keys()) {
      this._sendSub(marketSymbol);
    }
  }

  _onDisconnected() {
    if (!this._finalClosing) {
      clearTimeout(this._reconnectHandle);
      this._watcher.stop();
      this.emit('disconnected');
      this.consumer.disconnected(this.apiName);
      this._reconnectHandle = setTimeout(() => this.reconnect(false), this._retryTimeoutMs);
    }
  }
  _handleMessages(){
    while (this.messages.length !== 0) {
      let origData = this.messages.splice(0,1)[0];
      let raw = origData;
      // message format
      // { type: 'utf8', utf8Data: '{"C":"d-5ED873F4-C,0|Ejin,0|Ejio,2|I:,67FC","M":[{"H":"CoreHub","M":"updateExchangeState","A":[{"MarketName":"BTC-ETH","Nounce":26620,"Buys":[{"Type":0,"Rate":0.07117610,"Quantity":7.22300000},{"Type":1,"Rate":0.07117608,"Quantity":0.0},{"Type":0,"Rate":0.07114400,"Quantity":0.08000000},{"Type":0,"Rate":0.07095001,"Quantity":0.46981436},{"Type":1,"Rate":0.05470000,"Quantity":0.0},{"Type":1,"Rate":0.05458200,"Quantity":0.0}],"Sells":[{"Type":2,"Rate":0.07164500,"Quantity":21.55180000},{"Type":1,"Rate":0.07179460,"Quantity":0.0},{"Type":0,"Rate":0.07180300,"Quantity":6.96349769},{"Type":0,"Rate":0.07190173,"Quantity":0.27815742},{"Type":1,"Rate":0.07221246,"Quantity":0.0},{"Type":0,"Rate":0.07223299,"Quantity":58.39672846},{"Type":1,"Rate":0.07676211,"Quantity":0.0}],"Fills":[]}]}]}' }
      // this.message.push(raw);
      if (!raw.utf8Data) {
        if(raw.MarketName){
          let market = this._level2UpdateSubs.get(raw.MarketName);
          let l2update = this._constructLevel2Update(raw, market);

          this.emit('l2update');
          const status = this.consumer.handleUpdate(l2update);
          if(status && status === 'Wrong'){
            this._handleCoinReconection(raw.MarketName);
          }
        }
        continue;
      }
      raw = JSON.parse(raw.utf8Data);

      if (!raw.M) continue;

      for (let msg of raw.M) {
        if (msg.M === "updateExchangeState") {
          msg.A.forEach(data => {
            if (this.prevSeqDict[data.MarketName] && this.prevSeqDict[data.MarketName].outOfSync) {
              return;
            }
            if (this._tradeSubs.has(data.MarketName)) {
              let market = this._tradeSubs.get(data.MarketName);
              data.Fills.forEach(fill => {
                let trade = this._constructTradeFromMessage(fill, market);
                // this.emit("trade", trade, market);
              });
            }
            if (this._level2UpdateSubs.has(data.MarketName)) {
              if (!this.snapshots[data.MarketName]){
                if (!this.lostMessages[data.MarketName]){
                  this.lostMessages[data.MarketName] = [];
                }
                this.lostMessages[data.MarketName].push(data);
                return;
              }
              let market = this._level2UpdateSubs.get(data.MarketName);
              let l2update = this._constructLevel2Update(data, market);

              this.emit('l2update');
              const status = this.consumer.handleUpdate(l2update);
              if(status && status === 'Wrong'){
                this._handleCoinReconection(data.MarketName);
              }
            }
          });
        }
        if (msg.M === "updateSummaryState") {
          for (let raw of msg.A[0].Deltas) {
            if (this._tickerSubs.has(raw.MarketName)) {
              let market = this._tickerSubs.get(raw.MarketName);
              let ticker = this._constructTicker(raw, market);
              // this.emit("ticker", ticker, market);
            }
          }
        }
      }
    }
    this.isRunning = false;
  }
  _onMessage(raw) {
    this.messages.push(raw);
    if(this.messages.length > 0 && !this.isRunning){
      this.isRunning = true;
      this._handleMessages();
    }
  }

  _constructTicker(msg, market) {
    let {High, Low, Last, PrevDay, BaseVolume, Volume, TimeStamp, Bid, Ask} = msg;
    let change = Last - PrevDay;
    let percentChange = ((Last - PrevDay) / PrevDay) * 100;
    return new Ticker({
      exchange: "Bittrex",
      base: market.base,
      quote: market.quote,
      timestamp: moment.utc(TimeStamp).valueOf(),
      last: Last,
      open: PrevDay,
      high: High,
      low: Low,
      volume: BaseVolume,
      quoteVolume: Volume,
      change: change,
      changePercent: percentChange,
      bid: Bid,
      ask: Ask,
    });
  }

  _constructTradeFromMessage(msg, market) {
    let tradeId = this._getTradeId(msg);
    let unix = moment.utc(msg.TimeStamp).valueOf();
    let price = msg.Rate;
    let amount = msg.Quantity;
    let side = msg.OrderType === "BUY" ? "buy" : "sell";
    return new Trade({
      exchange: "Bittrex",
      base: market.base,
      quote: market.quote,
      tradeId,
      unix,
      side,
      price,
      amount,
    });
  }

  // prettier-ignore
  _constructLevel2Snapshot(msg, market) {
    let sequenceId = msg.Nonce;
    let bids = msg.Buys.map(p => new Level2Point(p.Rate, p.Quantity, undefined, {type: p.Type}));
    let asks = msg.Sells.map(p => new Level2Point(p.Rate, p.Quantity, undefined, {type: p.Type}));
    return new Level2Snapshot({
      exchange: "Bittrex",
      base: market.base,
      quote: market.quote,
      sequenceId,
      asks,
      bids,
    });
  }

  _handleCoinReconection(remote_id) {
    console.log(`handle recconection for coin ${remote_id}`);
    delete this.snapshots[remote_id];

    this.emit('disconnected', remote_id);
    this.consumer.disconnected(this.apiName, remote_id);

    // otherwise initiate the unsubscription
    this._wss.call('CoreHub', 'QueryExchangeState', remote_id).done((err, result) => {
      if (err) return winston.error('snapshot failed', remote_id, err);
      if (!result) return winston.warn('snapshot empty', remote_id);
      this.snapshots[remote_id] = 1;
      let snapshot = this._constructLevel2Snapshot(result, this._level2UpdateSubs.get(remote_id));
      this.emit('reconnected');
      this.consumer.reconnected(this.apiName, remote_id);
      this.prevSeqDict[remote_id].outOfSync = false;
      this.emit('l2snapshot');
      this.consumer.handleSnapshot(snapshot);
    });
  }

  // prettier-ignore
  _constructLevel2Update(msg, market) {
    let sequenceId = msg.Nonce;
    let bids = msg.Buys.map(p => new Level2Point(p.Rate, p.Quantity, undefined, {type: p.Type}));
    let asks = msg.Sells.map(p => new Level2Point(p.Rate, p.Quantity, undefined, {type: p.Type}));

    if (!this.prevSeqDict[msg.MarketName]) {
      this.prevSeqDict[msg.MarketName] = {sequenceId, outOfSync: false};
    } else if (this.prevSeqDict[msg.MarketName].outOfSync) {
      return;
    } else {
      if (this.prevSeqDict[msg.MarketName].sequenceId !== 0 && sequenceId - this.prevSeqDict[msg.MarketName].sequenceId !== 1) {
        console.log(`bittrex book out of sync ${sequenceId - this.prevSeqDict[msg.MarketName].sequenceId}`);
        this.prevSeqDict[msg.MarketName] = {sequenceId: 0, outOfSync: true};
        this.emit('disconnected');
        this.consumer.disconnected(this.apiName, msg.MarketName);
        setTimeout(async () => {
          this._handleCoinReconection(msg.MarketName);
        }, 10000);
      } else {
        this.prevSeqDict[msg.MarketName].sequenceId = sequenceId;
      }
    }

    return new Level2Update({
      exchange: "Bittrex",
      base: market.base,
      quote: market.quote,
      sequenceId,
      asks,
      bids,
    });
  }

  _getTradeId(msg) {
    let ms = moment.utc(msg.TimeStamp).valueOf();
    let buysell = msg.OrderType === "BUY" ? 1 : 0;
    let price = msg.Rate;
    let amount = msg.Quantity;
    let preimage = `${ms}:${buysell}:${price}:${amount}`;
    let hasher = crypto.createHash("md5");
    hasher.update(preimage);
    let tradeId = hasher.digest().toString("hex");
    return tradeId;
  }
}

module.exports = BittrexClient;
