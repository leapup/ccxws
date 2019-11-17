const semaphore = require('semaphore');
const pako = require('pako');
const BasicClient = require('../basic-client');
const Ticker = require('../ticker');
const Trade = require('../trade');
const Level2Point = require('../level2-point');
const Level2Snapshot = require('../level2-snapshot');
const Level2Update = require('../level2-update');

class OKExClient extends BasicClient {
  constructor(params) {
    super('wss://real.okex.com:10442/ws/v3', 'okex3', params.consumer);
    this._pingInterval = setInterval(this._sendPing.bind(this), 30000);
    this.on("connected", this._resetSemaphore.bind(this));
    this.on("connected", this._startPing.bind(this));
    this.on("disconnected", this._stopPing.bind(this));
    this.consumer = params.consumer;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Snapshots = true;
    this.hasLevel2Updates = true;
  }

  _resetSemaphore() {
    this._sem = semaphore(5);
    this._hasSnapshot = new Set();
  }

  _startPing() {
    this._pingInterval = setInterval(this._sendPing.bind(this), 30000);
  }

  _stopPing() {
    clearInterval(this._pingInterval)
  }

  _sendPing() {
    if (this._wss) {
      this._wss.send(JSON.stringify({ event: 'ping' }));
    }
  }

  _sendSubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'addChannel',
        channel: `ok_sub_spot_${remote_id}_ticker`,
      }),
    );
  }

  _sendUnsubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'removeChannel',
        channel: `ok_sub_spot_${remote_id}_ticker`,
      }),
    );
  }

  _sendSubTrades(remote_id) {
    let [base, quote] = remote_id.split('_');
    this._wss.send(
      JSON.stringify({
        event: 'addChannel',
        parameters: { base, binary: '0', product: 'spot', quote, type: 'deal' },
      }),
    );
  }

  _sendUnsubTrades(remote_id) {
    let [base, quote] = remote_id.split('_');
    this._wss.send(
      JSON.stringify({
        event: 'removeChannel',
        parameters: { base, binary: '0', product: 'spot', quote, type: 'deal' },
      }),
    );
  }

  _sendSubLevel2Snapshots(remote_id, { depth = 100 } = {}) {
    this._wss.send(
      JSON.stringify({
        op: 'subscribe',
        args: [`spot/depth:${remote_id}`],
      }),
    );
  }

  _sendUnsubLevel2Snapshots(remote_id, { depth = 100 } = {}) {
    this._wss.send(
      JSON.stringify({
        op: 'subscribe',
        args: [`spot/depth:${remote_id}`],
      }),
    );
  }

  _sendSubLevel2Updates(remote_id) {
    let all_remotes = remote_id.map(symbol => `spot/depth:${symbol}`);
    this._wss.send(
      JSON.stringify({
        op: 'subscribe',
        args: all_remotes,
      }),
    );
  }

  _sendUnsubLevel2Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'removeChannel',
        channel: `ok_sub_spot_${remote_id}_depth`,
      }),
    );
  }

  _onMessage(raw) {
    let msgs = null;
    try {
      msgs = JSON.parse(pako.inflateRaw(raw, { to: 'string' }));
    } catch (e) {
      console.log(e);
      return;
    }

    if (Array.isArray(msgs.data)) {
      for (let msg of msgs.data) {
        if (msgs.action === 'partial') {
          let snapshot = this._constructLevel2Snapshot(msg);
          this.emit('l2snapshot');
          this.consumer.handleSnapshot(snapshot);
          return;
        }
        if (msgs.action === 'update') {
          let update = this._constructoL2Update(msg);
          this.emit('l2update');
          this.consumer.handleUpdate(update);
          return;
        }
      }
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
    let remoteId = msg.channel.substr('ok_sub_spot_'.length).replace('_ticker', '');
    let market = this._tickerSubs.get(remoteId);
    let { open, vol, last, buy, change, sell, dayLow, dayHigh, timestamp } = msg.data;
    let dayChangePercent = (parseFloat(change) / parseFloat(open)) * 100;
    return new Ticker({
      exchange: 'okex3',
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
    /*
        [{ base: '1st',
          binary: 0,
          channel: 'addChannel',
          data: { result: true },
          product: 'spot',
          quote: 'btc',
          type: 'deal' },
        { base: '1st',
          binary: 0,
          data:
          [ { amount: '818.619',
              side: 1,
              createdDate: 1527013680457,
              price: '0.00003803',
              id: 4979071 },
          ],
          product: 'spot',
          quote: 'btc',
          type: 'deal' }]
        */
    let { amount, side, createdDate, price, id } = datum;
    let market = this._tradeSubs.get(remoteId);
    side = side === 1 ? 'buy' : 'sell';

    return new Trade({
      exchange: 'okex3',
      base: market.base,
      quote: market.quote,
      tradeId: id,
      side,
      unix: createdDate,
      price,
      amount,
    });
  }

  _constructLevel2Snapshot(msg) {
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
    let remote_id = msg.instrument_id;
    let market = this._level2UpdateSubs.get(remote_id);
    let asks = msg.asks.map(p => new Level2Point(p[0], p[1]));
    let bids = msg.bids.map(p => new Level2Point(p[0], p[1]));
    return new Level2Snapshot({
      exchange: 'okex3',
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
    let remote_id = msg.instrument_id;
    let market = this._level2UpdateSubs.get(remote_id);

    let asks = msg.asks ? msg.asks.map(p => new Level2Point(p[0], p[1])) : [];
    let bids = msg.bids ? msg.bids.map(p => new Level2Point(p[0], p[1])) : [];
    return new Level2Update({
      exchange: 'okex3',
      base: market.base,
      quote: market.quote,
      timestampMs: msg.timestamp,
      asks,
      bids,
    });
  }
}

module.exports = OKExClient;
