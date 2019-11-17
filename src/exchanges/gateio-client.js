const BasicClient = require('../basic-client');
const Ticker = require('../ticker');
const Trade = require('../trade');
const Level2Point = require('../level2-point');
const Level2Update = require('../level2-update');
const moment = require('moment');

class GateIOClient extends BasicClient {
  constructor(params) {
    super("wss://ws.gate.io/v3", "Gateio", params.consumer);
    this.consumer = params.consumer;
    // this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Updates = true;
    this.hasLevel2Snapshots = true;
    this.idMapping = [];
    this._pingInterval = setInterval(this._sendPing.bind(this), 30000);
  }
  _sendPing() {
    if (this._wss) {
      this._wss.send(JSON.stringify({ method: 'server.ping' }));
    }
  }
  // _sendSubTicker(remote_id) {
  //   this._wss.send(
  //     JSON.stringify({
  //       method: "subscribe",
  //       params: {
  //         channel: `lightning_ticker_${remote_id}`,
  //       },
  //     })
  //   );
  // }
  //
  // _sendUnsubTicker(remote_id) {
  //   this._wss.send(
  //     JSON.stringify({
  //       method: "unsubscribe",
  //       params: {
  //         channel: `lightning_ticker_${remote_id}`,
  //       },
  //     })
  //   );
  // }

  _sendSubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        method: 'subscribe',
        params: {
          channel: `lightning_executions_${remote_id}`,
        },
      }),
    );
  }

  _sendSubLevel2Updates(remote_id) {
    let all_remotes = remote_id.map(remote_id => [remote_id, 30, '0.00000001']);
    this._wss.send(
      JSON.stringify({
        method: 'depth.subscribe',
        params: all_remotes,
        id: this.getId(remote_id),
      }),
    );
  }

  getId(key) {
    let index = this.idMapping.indexOf(key);
    if (index === -1) this.idMapping.push(key);
    return index !== -1 ? index : this.idMapping.length - 1;
  }

  _sendSubLevel2Snapshots(remote_id) {
    this._wss.send(
      JSON.stringify({
        method: 'depth.subscribe',
        params: [remote_id, 30, '0.1'],
        id: this.getId(remote_id),
      }),
    );
  }

  _sendUnsubTrades(remote_id) {
    throw new Error('not implemented');
    // this._wss.send(
    //   JSON.stringify({
    //     method: "unsubscribe",
    //     params: {
    //       channel: `lightning_executions_${remote_id}`,
    //     },
    //   })
    // );
  }

  _sendUnsubLevel2Updates(remote_id) {
    throw new Error('not implemented');
    // this._wss.send(
    //   JSON.stringify({
    //     method: "unsubscribe",
    //     params: {
    //       channel: `lightning_board_${remote_id}`,
    //     },
    //   })
    // );
  }

  _onResendMessages(){
    for(let i=0;i<this.messages.length; i++){
      this._onMessage(this.messages[i]);
    }
    console.log('done');
  }

  _onMessage(data) {
    let parsed = JSON.parse(data);
    // if(parsed && parsed.error)
    //   console.log(parsed.error);
    if (!parsed || parsed.error) {
      return;
    }
    if (parsed.method === 'depth.update') {
      if (parsed.params && parsed.params[1] && parsed.params[2]) {
        if (parsed.params[0]) {
          let update = this._constructLevel2Snapshot(parsed.params[2], parsed.params[1]);
          this.emit('l2snapshot', update);
          this.consumer.handleSnapshot(update);
        } else {
          let update = this._constructLevel2Snapshot(parsed.params[2], parsed.params[1]);
          this.emit('l2update', update);
          this.consumer.handleUpdate(update);
        }
      }
    }

    // if (channel.startsWith("lightning_ticker_")) {
    //   let remote_id = channel.substr("lightning_ticker_".length);
    //   let ticker = this._createTicker(remote_id, message);
    //   this.emit("ticker", ticker);
    //   return;
    // }
    //
    // // trades
    // if (channel.startsWith("lightning_executions_")) {
    //   let remote_id = channel.substr("lightning_executions_".length);
    //   for (let datum of message) {
    //     let trade = this._createTrades(remote_id, datum);
    //     this.emit("trade", trade);
    //   }
    // }
    // if (channel.startsWith("lightning_board_snapshot_")) {
    //   // let remote_id = channel.substr("lightning_board_snapshot_".length);
    //   let update = this._constructLevel2Snapshot(remote_id, message);
    //   this.emit("l2snapshot", update);
    // }
    // else if (channel.startsWith("lightning_board_")) {
    //   let remote_id = channel.substr("lightning_board_".length);
    //   let update = this._createLevel2Update(remote_id, message);
    //   this.emit("l2update", update);
    // }
  }

  _createTicker(remoteId, data) {
    let { timestamp, best_bid, best_ask, best_bid_size, best_ask_size, ltp, volume, volume_by_product } = data;
    let market = this._tickerSubs.get(remoteId);
    return new Ticker({
      exchange: 'GateIO',
      base: market.base,
      quote: market.quote,
      timestamp: moment.utc(timestamp).valueOf(),
      last: ltp.toFixed(8),
      volume: volume.toFixed(8),
      quoteVolume: volume_by_product.toFixed(8),
      bid: best_bid.toFixed(8),
      bidVolume: best_bid_size.toFixed(8),
      ask: best_ask.toFixed(8),
      askVolume: best_ask_size.toFixed(8),
    });
  }

  _createTrades(remoteId, datum) {
    let { size, side, exec_date, price, id } = datum;
    let market = this._tradeSubs.get(remoteId);

    side = side.toLowerCase();
    let unix = moment(exec_date).valueOf();

    return new Trade({
      exchange: 'GateIO',
      base: market.base,
      quote: market.quote,
      tradeId: id,
      unix,
      side: side.toLowerCase(),
      price: price.toFixed(15),
      amount: size.toFixed(15),
    });
  }

  // prettier-ignore
  _constructLevel2Snapshot(remote_id, msg) {
    let market = this._level2UpdateSubs.get(remote_id);
    let asks = msg.asks ? msg.asks.map(p => new Level2Point(p[0], p[1])): [];
    let bids = msg.bids ? msg.bids.map(p => new Level2Point(p[0], p[1])) : [];

    return new Level2Update({
      exchange: "GateIO",
      base: market.base,
      quote: market.quote,
      asks,
      bids,
    });
  }

  _createLevel2Update(remote_id, msg) {
    let market = this._level2UpdateSubs.get(remote_id);
    let asks = msg.asks.map(p => new Level2Point(p.price, p.size));
    let bids = msg.bids.map(p => new Level2Point(p.price.toFixed(15), p.size.toFixed(15)));

    return new Level2Update({
      exchange: 'GateIO',
      base: market.base,
      quote: market.quote,
      asks,
      bids,
    });
  }
}

module.exports = GateIOClient;
