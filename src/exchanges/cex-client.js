const winston = require("winston");
const Ticker = require("../ticker");
const Trade = require("../trade");
const Level2Point = require("../level2-point");
const Level2Snapshot = require("../level2-snapshot");
const BasicAuthClient = require("../basic-auth-client");
const BasicMultiClient = require("../basic-multiclient");
const Watcher = require("../watcher");

class CexClient extends BasicMultiClient {
  constructor(args) {
    super(args);
    this._clients = new Map();
    this.consumer = args.consumer;
    this._name = "CEX_MULTI";
    this.auth = args;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Snapshots = true;
  }

  _createBasicClient(clientArgs) {
    return new SingleCexClient({ auth: this.auth, market: clientArgs.market, consumer: this.consumer });
  }
}

class SingleCexClient extends BasicAuthClient {
  constructor(args) {
    super("wss://ws.cex.io/ws", "CEX", args.consumer);
    this._watcher = new Watcher(this, 15 * 60 * 1000);
    this.consumer = args.consumer;
    this.auth = args.auth;
    this.market = args.market;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Snapshots = true;
  }

  _sendPong() {
    if (this._wss) {
      this._wss.send(JSON.stringify({ e: "pong" }));
    }
  }

  _sendSubTicker() {
    this._wss.send(
      JSON.stringify({
        e: "subscribe",
        rooms: ["tickers"],
      })
    );
  }

  _sendUnsubTicker() {}

  _sendSubTrades(remote_id) {
    let localRemote_id = remote_id; //`pair-${remote_id}`;
    winston.info("subscribing to trades", "CEX", localRemote_id);
    this._wss.send(
      JSON.stringify({
        e: "subscribe",
        rooms: [remote_id],
      })
    );
  }

  _sendUnsubTrades() {}

  _sendSubLevel2Snapshots(remote_id) {
    let localRemote_id = remote_id;
    winston.info("subscribing to level2 snapshots", "SINGLE CEX", localRemote_id);
    this._wss.send(
      JSON.stringify({
        e: "subscribe",
        rooms: [remote_id],
      })
    );
  }

  _constructTicker(data, market) {
    // {"e":"tick","data":{"symbol1":"BTC","symbol2":"USD","price":"4244.4","open24":"4248.4","volume":"935.58669239"}}
    let { open24, price, volume } = data;
    let change = parseFloat(price) - parseFloat(open24);
    let changePercent =
      open24 !== 0 ? ((parseFloat(price) - parseFloat(open24)) / parseFloat(open24)) * 100 : 0;

    return new Ticker({
      exchange: "CEX",
      base: market.base,
      quote: market.quote,
      timestamp: Date.now(),
      last: price,
      open: open24,
      volume: volume,
      change: change,
      changePercent: changePercent,
    });
  }

  _constructevel2Snapshot(msg, market) {
    let multiplier;
    switch (market.base) {
      case 'BTG':
      case 'BTC':
      case 'BCH':
      case 'LTC':
      case 'ZEC':
      case 'DASH':
        multiplier = 0.00000001;
        break;
      case 'GUSD':
        multiplier = 0.01;
        break;
      case 'XLM':
        multiplier = 0.0000001;
        break;
      default:
        multiplier = 0.000001;
        break;
    }

    let asks = msg.sell.map(p => new Level2Point(p[0], p[1] * multiplier));
    let bids = msg.buy.map(p => new Level2Point(p[0], p[1] * multiplier));
    return new Level2Snapshot({
      exchange: "CEX",
      base: market.base,
      quote: market.quote,
      sequenceId: msg.id,
      asks,
      bids,
    });
  }

  _constructTrade(data, market) {
    //["buy","1543967891439","4110282","3928.1","9437977"]
    //format: sell/buy, timestamp_ms, amount, price, transaction_id
    let [side, timestamp_ms, amount, price, tradeId] = data;

    return new Trade({
      exchange: "CEX",
      base: market.base,
      quote: market.quote,
      tradeId: tradeId,
      unix: parseInt(timestamp_ms),
      side: side,
      price: price,
      amount: amount,
    });
  }

  _onMessage(raw) {
    let message = JSON.parse(raw);
    let { e, data } = message;

    if (e === "ping") {
      this._sendPong();
      return;
    }

    if (e === "subscribe") {
      if (message.error) {
        throw new Error(`CEX error: ${message.error}`);
      }
    }

    if (e === "auth") {
      if (data.ok === "ok") {
        this._onAuthorized();
      } else {
        throw new Error("Authentication error");
      }
      return;
    }

    if (e === "tick") {
      // {"e":"tick","data":{"symbol1":"BTC","symbol2":"USD","price":"4244.4","open24":"4248.4","volume":"935.58669239"}}
      let marketId = `${data.symbol1}-${data.symbol2}`;
      let market = this._tickerSubs.get(marketId);
      if (!market) return;

      let ticker = this._constructTicker(data, market);
      this.emit("ticker", ticker, market);
      return;
    }

    if (e === "md") {
      let marketId = data.pair.replace(":", "-");
      let market = this._level2SnapshotSubs.get(marketId);
      if (!market) return;

      let result = this._constructevel2Snapshot(data, market);
      this.emit('l2snapshot');
      this.consumer.handleSnapshot(result);
      return;
    }

    if (e === "history") {
      let marketId = this.market.id;
      let market = this._tradeSubs.get(marketId);
      if (!market) return;

      // sell/buy:timestamp_ms:amount:price:transaction_id
      for (let rawTrade of data) {
        let tradeData = rawTrade.split(":");
        let trade = this._constructTrade(tradeData, market);
        this.emit("trade", trade, market);
      }
      return;
    }

    if (e === "history-update") {
      let marketId = this.market.id;
      let market = this._tradeSubs.get(marketId);
      if (this._tradeSubs.has(marketId)) {
        for (let rawTrade of data) {
          let trade = this._constructTrade(rawTrade, market);
          this.emit("trade", trade);
        }
        return;
      }
    }
  }
}

module.exports = CexClient;
