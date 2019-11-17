const moment = require("moment");
const winston = require("winston");
const semaphore = require("semaphore");
const BasicClient = require("../basic-client");
const Ticker = require("../ticker");
const Trade = require("../trade");
const Level2Point = require("../level2-point");
const Level2Snapshot = require("../level2-snapshot");
const Level2Update = require("../level2-update");

class HitBTCClient extends BasicClient {
  constructor(params) {
    super("wss://api.hitbtc.com/api/2/ws", "HitBTC", params.consumer);
    this._id = 0;
    this.consumer = params.consumer;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Updates = true;
    this.throttleMs = 100;
    this.on("connected", this._resetSemaphore.bind(this));
  }

  _resetSemaphore() {
    // We use semaphores to throttle connectivity. Upon taking the
    // semaphore, we release it within 100ms, which should
    // be long enough to ensure that the connection was created
    this._sem = semaphore(4);
  }

  _sendSubTicker(remote_id) {
    this._sem.take(() => {
      setTimeout(() => this._sem.leave(), this.throttleMs);
      this._wss.send(
        JSON.stringify({
          method: "subscribeTicker",
          params: {
            symbol: remote_id,
          },
          id: ++this._id,
        })
      );
    });
  }

  _sendUnsubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        method: "unsubscribeTicker",
        params: {
          symbol: remote_id,
        },
      })
    );
  }

  _sendSubTrades(remote_id) {
    this._sem.take(() => {
      setTimeout(() => this._sem.leave(), this.throttleMs);
      this._wss.send(
        JSON.stringify({
          method: "subscribeTrades",
          params: {
            symbol: remote_id,
          },
          id: ++this._id,
        })
      );
    });
  }

  _sendUnsubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        method: "unsubscribeTrades",
        params: {
          symbol: remote_id,
        },
      })
    );
  }

  _sendSubLevel2Updates(remote_id) {
    this._sem.take(() => {
      setTimeout(() => this._sem.leave(), this.throttleMs);
      this._wss.send(
        JSON.stringify({
          method: "subscribeOrderbook",
          params: {
            symbol: remote_id,
          },
          id: ++this._id,
        })
      );
    });
  }

  _sendUnsubLevel2Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        method: "unsubscribeOrderbook",
        params: {
          symbol: remote_id,
        },
      })
    );
  }

  _onMessage(raw) {
    let msg = JSON.parse(raw);

    // The payload for a subscribe confirm will include the id that
    // was attached in the JSON-RPC call creation.  For example:
    // { jsonrpc: '2.0', result: true, id: 7 }
    //
    // For unsubscribe calls, we are not including an id
    // so we can ignore messages that do not can an id value:
    // { jsonrpc: '2.0', result: true, id: null }
    if (msg.result !== undefined && msg.id) {
      if (!msg.result) winston.warn(msg);
      return;
    }

    let remote_id = msg.params && msg.params.symbol;

    if (msg.method === "ticker") {
      let market = this._tickerSubs.get(remote_id);
      if (!market) return;

      let ticker = this._constructTicker(msg.params, market);
      this.emit("ticker", ticker, market);
    }

    if (msg.method === "updateTrades") {
      let market = this._tradeSubs.get(remote_id);
      if (!market) return;

      for (let datum of msg.params.data) {
        let trade = this._constructTradesFromMessage(datum, market);
        this.emit("trade", trade, market);
      }
      return;
    }

    if (msg.method === "snapshotOrderbook") {
      let market = this._level2UpdateSubs.get(remote_id); // coming from l2update sub
      if (!market) return;

      let result = this._constructLevel2Snapshot(msg.params, market);
      this.emit('l2snapshot');
      this.consumer.handleSnapshot(result);
      return;
    }

    if (msg.method === "updateOrderbook") {
      let market = this._level2UpdateSubs.get(remote_id);
      if (!market) return;

      let result = this._constructLevel2Update(msg.params, market);
      this.emit('l2update');
      this.consumer.handleUpdate(result);
      return;
    }
  }

  _constructTicker(param, market) {
    let { ask, bid, last, open, low, high, volume, volumeQuote, timestamp } = param;
    let change = (parseFloat(last) - parseFloat(open));
    let changePercent = (((parseFloat(last) - parseFloat(open)) / parseFloat(open)) * 100);
    return new Ticker({
      exchange: "HitBTC",
      base: market.base,
      quote: market.quote,
      timestamp: moment.utc(timestamp).valueOf(),
      last,
      open,
      high,
      low,
      volume,
      quoteVolume: volumeQuote,
      ask,
      bid,
      change,
      changePercent,
    });
  }

  _constructTradesFromMessage(datum, market) {
    let { id, price, quantity, side, timestamp } = datum;

    let unix = moment(timestamp).valueOf();

    return new Trade({
      exchange: "HitBTC",
      base: market.base,
      quote: market.quote,
      tradeId: id,
      side,
      unix,
      price,
      amount: quantity,
    });
  }

  _constructLevel2Snapshot(data, market) {
    let { ask, bid, sequence } = data;
    let asks = ask.map(p => new Level2Point(p.price, p.size));
    let bids = bid.map(p => new Level2Point(p.price, p.size));
    return new Level2Snapshot({
      exchange: "HitBTC2",
      base: market.base,
      quote: market.quote,
      sequenceId: sequence,
      asks,
      bids,
    });
  }

  _constructLevel2Update(data, market) {
    let { ask, bid, sequence } = data;
    let asks = ask.map(p => new Level2Point(p.price, p.size, p.count));
    let bids = bid.map(p => new Level2Point(p.price, p.size, p.count));
    return new Level2Update({
      exchange: "HitBTC2",
      base: market.base,
      quote: market.quote,
      sequenceId: sequence,
      asks,
      bids,
    });
  }
}

module.exports = HitBTCClient;
