const BasicClient = require('../basic-client');
const Ticker = require('../ticker');
const Trade = require('../trade');
const Level2Point = require('../level2-point');
const Level2Snapshot = require('../level2-snapshot');

class LbankClient extends BasicClient {
  constructor(params) {
    super('wss://api.lbkex.com/ws/V2/', 'Lbank', params.consumer);
    this.consumer = params.consumer;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Snapshots = true;
    // this.prevTickDic = {};
  }

  _sendPong(ts) {
    if (this._wss) {
      this._wss.send(JSON.stringify({ pong: ts }));
    }
  }

  _sendSubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        sub: `market.${remote_id}.detail`,
        id: remote_id,
      }),
    );
  }

  _sendUnsubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        unsub: `market.${remote_id}.detail`,
        id: remote_id,
      }),
    );
  }

  _sendSubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        sub: `market.${remote_id}.trade.detail`,
        id: remote_id,
      }),
    );
  }

  _sendUnsubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        unsub: `market.${remote_id}.trade.detail`,
        id: remote_id,
      }),
    );
  }

  _sendSubLevel2Snapshots(remote_id) {
    this._wss.send(
      JSON.stringify({
        action: 'subscribe',
        subscribe: 'depth',
        depth: 50,
        pair: remote_id,
      }),
    );
  }

  _sendUnsubLevel2Snapshots(remote_id) {
    this._wss.send(
      JSON.stringify({
        unsub: `market.${remote_id}.depth.step0`,
      }),
    );
  }

  _onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.type === 'depth') {
      let update = this._constructLevel2Snapshot(msg);
      this.emit('l2snapshot');
      this.consumer.handleSnapshot(update);
      return;
    } else if (msg.type === 'ping') {
      console.log(raw);
    } else {
      console.log(raw);
    }
  }

  _constructTicker(remoteId, data) {
    let { open, close, high, low, vol, amount } = data;
    let market = this._tickerSubs.get(remoteId);
    let dayChange = close - open;
    let dayChangePercent = ((close - open) / open) * 100;
    return new Ticker({
      exchange: 'Huobi',
      base: market.base,
      quote: market.quote,
      timestamp: Date.now(),
      last: close,
      open: open,
      high: high,
      low: low,
      volume: amount,
      quoteVolume: vol,
      change: dayChange,
      changePercent: dayChangePercent,
    });
  }

  _constructTradesFromMessage(remoteId, datum) {
    let { amount, direction, ts, price, id } = datum;
    let market = this._tradeSubs.get(remoteId);
    let unix = Math.trunc(parseInt(ts));

    return new Trade({
      exchange: 'Huobi',
      base: market.base,
      quote: market.quote,
      tradeId: id,
      side: direction,
      unix,
      price,
      amount,
    });
  }

  _constructLevel2Snapshot(msg) {
    if (msg.pair.includes('bcc')) {
      msg.pair = msg.pair.replace('bcc', 'bch');
    }

    let market = this._level2SnapshotSubs.get(msg.pair);

    let bids = msg.depth.bids.map(p => new Level2Point(p[0], p[1]));
    let asks = msg.depth.asks.map(p => new Level2Point(p[0], p[1]));
    if (!market) {
      return;
    }
    return new Level2Snapshot({
      exchange: 'Lbank',
      base: market.base,
      quote: market.quote,
      timestampMs: msg.TS,
      asks,
      bids,
    });
  }
}

module.exports = LbankClient;
