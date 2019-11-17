const { find } = require('underscore');
const BasicClient = require('../basic-client');
const Ticker = require('../ticker');
const Trade = require('../trade');
const Level2Point = require('../level2-point');
const Level2Snapshot = require('../level2-snapshot');
const Level2Update = require('../level2-update');
const Level3Point = require('../level3-point');
const Level3Update = require('../level3-update');

class BitfinexClient extends BasicClient {
  constructor(params) {
    super('wss://api.bitfinex.com/ws/2', 'Bitfinex',params.consumer);
    this._channels = {};
    this.apiName = 'bitfinex';
    this.consumer = params.consumer;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Updates = true;
    this.hasLevel3Updates = true;
    this.hasSubscribed = false;
  }

  _sendSubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'ticker',
        pair: remote_id,
      }),
    );
  }
  _sendUnsubTicker(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'unsubscribe',
        channel: 'ticker',
        pair: remote_id,
      }),
    );
  }

  _sendSubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'trades',
        pair: remote_id,
      }),
    );
  }

  _sendUnsubTrades(remote_id) {
    let chanId = this._findChannel('trades', remote_id);
    this._sendUnsubscribe(chanId);
  }

  _sendSubLevel2Updates(remote_id) {
    // if(this.hasSubscribed)
    //     return;
    this.hasSubscribed = true;
    this._wss.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'book',
        pair: remote_id,
        len: '100',
      })
    );
  }

  _sendUnsubLevel2Updates(remote_id) {
    let chanId = this._findChannel('level2updates', remote_id);
    this._sendUnsubscribe(chanId);
  }

  _sendSubLevel3Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'subscribe',
        channel: 'book',
        pair: remote_id,
        prec: 'R0',
        len: '100',
      }),
    );
  }

  _sendUnsubLevel3Updates(remote_id) {
    let chanId = this._findChannel('level3updates', remote_id);
    this._sendUnsubscribe(chanId);
  }

  _sendUnsubscribe(chanId) {
    if (chanId) {
      this._wss.send(
        JSON.stringify({
          event: 'unsubscribe',
          chanId: chanId,
        }),
      );
    }
  }

  _findChannel(type, remote_id) {
    for (let chan of Object.values(this._channels)) {
      if (chan.pair === remote_id) {
        if (type === 'trades' && chan.channel === 'trades') return chan.chanId;
        if (type === 'level2updates' && chan.channel === 'book' && chan.prec !== 'R0') return chan.chanId;
        if (type === 'level3updates' && chan.channel === 'book' && chan.prec === 'R0') return chan.chanId;
      }
    }
  }

  _onMessage(raw) {
    let msg = JSON.parse(raw);

    // capture channel metadata
    if (msg.event === 'subscribed') {
      const prevChanel = find(Object.keys(this._channels), key => this._channels[key].pair === msg.pair);
      if (prevChanel) {
        delete this._channels[prevChanel];
      }
      this._channels[msg.chanId] = msg;
      return;
    }

    // lookup channel
    let channel = this._channels[msg[0]];
    if (!channel) return;

    // ignore heartbeats
    if (msg[1] === 'hb') {
      return;
    }

    if (channel.channel === 'ticker') {
      this._onTicker(msg, channel);
      return;
    }

    // trades
    if (channel.channel === 'trades' && msg[1] === 'tu') {
      this._onTradeMessage(msg, channel);
      return;
    }

    // level3
    if (channel.channel === 'book' && channel.prec === 'R0') {
      if (Array.isArray(msg[1])) this._onLevel3Snapshot(msg, channel);
      else this._onLevel3Update(msg, channel);
      return;
    }

    // level2
    if (channel.channel === 'book') {
      if (msg[1] && msg[1][0] && Array.isArray(msg[1][0])) {
        this._onLevel2Snapshot(msg, channel);
      } else {
        for (let i = 1; i < msg.length; i++) {
          this._onLevel2Update(msg[i], channel);
        }
      }
      return;
    }
  }

  _onTicker(msg) {
    let [chanId, bid, bidSize, ask, askSize, change, changePercent, last, volume, high, low] = msg;
    let remote_id = this._channels[chanId].pair;
    let market = this._tickerSubs.get(remote_id);
    let open = last + change;
    let ticker = new Ticker({
      exchange: 'Bitfinex',
      base: market.base,
      quote: market.quote,
      timestamp: Date.now(),
      last: last,
      open: open,
      high: high,
      low: low,
      volume: volume,
      change: change,
      changePercent: changePercent,
      bid: bid,
      bidVolume: bidSize,
      ask: ask,
      askVolume: askSize,
    });
    this.emit('ticker', ticker);
  }

  _onTradeMessage(msg) {
    let [chanId, , , id, unix, price, amount] = msg;
    let remote_id = this._channels[chanId].pair;
    let market = this._tradeSubs.get(remote_id);
    let side = amount > 0 ? 'buy' : 'sell';
    price = price;
    amount = Math.abs(amount);
    let trade = new Trade({
      exchange: 'Bitfinex',
      base: market.base,
      quote: market.quote,
      tradeId: id,
      unix: unix * 1000,
      side,
      price,
      amount,
    });
    this.emit('trade', trade);
  }

  _onLevel2Snapshot(msg) {
    let remote_id = this._channels[msg[0]].pair;
    let market = this._level2UpdateSubs.get(remote_id); // this message will be coming from an l2update
    let bids = [];
    let asks = [];
    for (let val of msg[1]) {
      if (!val || !val[0]) {
        console.log('');
      }

      let result = new Level2Point(val[0], Math.abs(val[2]), val[1]);
      if (val[2] > 0) bids.push(result);
      else asks.push(result);
    }
    let result = new Level2Snapshot({
      exchange: 'Bitfinex',
      base: market.base,
      quote: market.quote,
      bids,
      asks,
    });
    this.emit('l2snapshot');
    this.consumer.handleSnapshot(result);
  }

  _onLevel2Update(msg, channel) {
    if (!Array.isArray(msg) || (!msg[0] && msg[0] !== 0) || (!msg[1] && msg[1] !== 0) || (!msg[2] && msg[2] !== 0)){
      console.log(`Msg has errors, msg: ${msg}`);
      return;
    }
    let remote_id = channel.pair;
    let market = this._level2UpdateSubs.get(remote_id);
    // if (!msg[1].toFixed) console.log(msg);
    //const pp = {price: msg[0], cnt: msg[1], amount: msg[2]};
    let point = new Level2Point(msg[0], Math.abs(msg[2]), msg[1]);
    let asks = [];
    let bids = [];
    if (+point.count === 0) {
      point.size = '0';
    }
    if (msg[2] >= 0) bids.push(point);
    else {
      asks.push(point);
    }
    // if(+point.count === 0) {
    //     point.size = "0";
    // }
    let update = new Level2Update({
      exchange: 'Bitfinex',
      base: market.base,
      quote: market.quote,
      asks,
      bids,
    });
    this.emit('l2update');
    this.consumer.handleUpdate(update);
  }

  _onLevel3Snapshot(msg, channel) {
    let remote_id = channel.pair;
    let market = this._level3UpdateSubs.get(remote_id); // this message will be coming from an l2update
    let bids = [];
    let asks = [];
    msg[1].forEach(p => {
      let point = new Level3Point(p[0], p[1], Math.abs(p[2]));
      if (p[2] > 0) bids.push(point);
      else asks.push(point);
    });
    let result = new Level2Snapshot({
      exchange: 'Bitfinex',
      base: market.base,
      quote: market.quote,
      asks,
      bids,
    });
    this.emit('l2snapshot');
    this.consumer.handleSnapshot(result);
  }

  _onLevel3Update(msg, channel) {
    let remote_id = channel.pair;
    let market = this._level3UpdateSubs.get(remote_id);
    let bids = [];
    let asks = [];

    let point = new Level3Point(msg[1], msg[2], Math.abs(msg[3]));
    if (msg[3] > 0) bids.push(point);
    else asks.push(point);

    let result = new Level3Update({
      exchange: 'Bitfinex',
      base: market.base,
      quote: market.quote,
      asks,
      bids,
    });
    this.emit('l3update', result);
  }
}

module.exports = BitfinexClient;