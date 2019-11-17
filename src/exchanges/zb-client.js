const semaphore = require('semaphore');
const BasicClient = require('../basic-client');
const Ticker = require('../ticker');
const Trade = require('../trade');
const Level2Point = require('../level2-point');
const Level2Snapshot = require('../level2-snapshot');
const Level2Update = require('../level2-update');

class ZBClient extends BasicClient {
  constructor(params) {
    super('wss://api.zb.cn/websocket', 'ZB', params.consumer);
    this._pingInterval = setInterval(this._sendPing.bind(this), 30000);
    this.consumer = params.consumer;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Snapshots = true;
    this.hasLevel2Updates = true;
  }

  _sendPing() {
    if (this._wss) {
      this._wss.send(JSON.stringify({event: 'ping'}));
    }
  }

  _sendSubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'addChannel',
        channel: `${remote_id}_ticker`,
      }),
    );
  }

  _sendUnsubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'removeChannel',
        channel: `${remote_id}_ticker`,
      }),
    );
  }

  _sendSubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'addChannel',
        channel: `${remote_id}_trades`,
      }),
    );
  }

  _sendUnsubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'removeChannel',
        channel: `${remote_id}_trades`,
      }),
    );
  }

  _sendSubLevel2Snapshots(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'addChannel',
        channel: `${remote_id}_depth`,
      }),
    );
  }

  _sendUnsubLevel2Snapshots(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'removeChannel',
        channel: `${remote_id}_depth`,
      }),
    );
  }

  _sendSubLevel2Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'addChannel',
        channel: `${remote_id}_depth`,
      }),
    );
  }

  _sendUnsubLevel2Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'removeChannel',
        channel: `${remote_id}_depth`,
      }),
    );
  }

  _onMessage(raw) {
    let msg = JSON.parse(raw);
    if (msg.success === false) return;
    // trades
    if (msg.dataType === 'trades') {
      let remote_id = msg.channel.replace('_trades', '');
      for (let datum of msg.data) {
        let trade = this._constructTradesFromMessage(remote_id, datum);
        this.emit('trade', trade);
      }
      return;
    }

    // tickers
    if (msg.channel.endsWith('_ticker')) {
      let ticker = this._constructTicker(msg);
      this.emit('ticker', ticker);
      return;
    }
    /*
          // l2 snapshots
          if (
            msg.channel.endsWith("_5") ||
            msg.channel.endsWith("_10") ||
            msg.channel.endsWith("_20")
          ) {
            let snapshot = this._constructLevel2Snapshot(msg);
            this.emit("l2snapshot", snapshot);
            return;
          }
    */
    // l2 updates
    if (msg.channel.endsWith('depth')) {
      let update = this._constructLevel2Snapshot(msg);
      this.emit('l2snapshot');
      this.consumer.handleSnapshot(update);
      return;
    }
  }

  _constructTicker(msg) {
    /*
    { binary: 0,
    channel: 'ok_sub_spot_eth_btc_ticker',
    data:
    { high: '0.07121405',
      vol: '53824.717918',
      last: '0.07071044',
      low: '0.06909468',
      buy: '0.07065946',
      change: '0.00141498',
      sell: '0.07071625',
      dayLow: '0.06909468',
      close: '0.07071044',
      dayHigh: '0.07121405',
      open: '0.06929546',
      timestamp: 1531692991115 } }
     */
    let remoteId = msg.channel.replace('_ticker', '');
    let market = this._tickerSubs.get(remoteId);
    let {open, vol, last, buy, change, sell, dayLow, dayHigh, timestamp} = msg.data;
    let dayChangePercent = (parseFloat(change) / parseFloat(open)) * 100;
    return new Ticker({
      exchange: 'ZB',
      base: market.base,
      quote: market.quote,
      timestamp,
      last,
      open,
      high: dayHigh,
      low: dayLow,
      volume: vol,
      change: change,
      changePercent: dayChangePercent,
      bid: buy,
      ask: sell,
    });
  }

  _constructTradesFromMessage(remoteId, datum) {
    let {amount, type, date, price, tid} = datum;
    let market = this._tradeSubs.get(remoteId);

    return new Trade({
      exchange: 'ZB',
      base: market.base,
      quote: market.quote,
      tradeId: tid,
      side: type,
      unix: date,
      price,
      amount,
    });
  }

  _constructLevel2Snapshot(msg) {
    let remote_id = msg.channel.replace('_depth', '');
    let market = this._level2SnapshotSubs.get(remote_id);

    let asks = msg.asks ? msg.asks.map(p => new Level2Point(p[0], p[1])).reverse() : [];
    let bids = msg.bids ? msg.bids.map(p => new Level2Point(p[0], p[1])) : [];
    return new Level2Update({
      exchange: 'zb',
      base: market.base,
      quote: market.quote,
      timestampMs: msg.timestamp,
      asks,
      bids,
    });
  }

  _constructoL2Update(msg) {
    /*
    [{
        "binary": 0,
        "channel": "ok_sub_spot_bch_btc_depth",
        "data": {
            "asks": [],
            "bids": [
                [
                    "115",
                    "1"
                ],
                [
                    "114",
                    "1"
                ],
                [
                    "1E-8",
                    "0.0008792"
                ]
            ],
            "timestamp": 1504529236946
        }
    }]
    */
    let remote_id = msg.channel.replace('_depth', '');
    let market = this._level2UpdateSubs.get(remote_id);

    let asks = msg.asks ? msg.asks.map(p => new Level2Point(p[0], p[1])).reverse() : [];
    let bids = msg.bids ? msg.bids.map(p => new Level2Point(p[0], p[1])) : [];
    return new Level2Update({
      exchange: 'zb',
      base: market.base,
      quote: market.quote,
      timestampMs: msg.timestamp,
      asks,
      bids,
    });
  }
}

module.exports = ZBClient;
