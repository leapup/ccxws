const { find } = require('underscore');
const BasicClient = require('../basic-client');
const zlib = require('zlib');
const winston = require('winston');
const Ticker = require('../ticker');
const Trade = require('../trade');
const Level2Point = require('../level2-point');
const Level2Snapshot = require('../level2-snapshot');
const Level2Update = require('../level2-update');
class KrakenClient extends BasicClient {
  constructor(params) {
    super('wss://ws.kraken.com', 'Kraken', params.consumer);
    this.consumer = params.consumer;
    this.hasTickers = true;
    this.hasTrades = true;
    this.hasLevel2Updates = true;
    // this.hasLevel2Snapshots = true;
    this.chanelIdToMarket = {};
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
        method: 'depth.subscribe',
        params: ['BTCBCH', 5, '0'],
        id: null,
      }),
    );
  }
  _sendUnsubLevel2Snapshots(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'unsubscribe',
        pair: [remote_id],
        subscription: { name: 'book' },
      })
    );
  }
  _sendSubLevel2Updates(remote_ids) {
    this._wss.send(
      JSON.stringify({
        event: 'subscribe',
        pair: remote_ids,
        subscription: { name: 'book', depth: 100 },
      }),
    );
  }
  _sendUnsubLevel2Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        event: 'unsubscribe',
        pair: [remote_id],
        subscription: { name: 'book' },
      })
    );
  }
  _onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.error) {
      console.log(msg.error);
      return;
    }
    if (msg.event === 'subscriptionStatus') {
      this.chanelIdToMarket[msg.channelID] = msg.pair;
    } else if (!msg.event) {
      if (msg[1].b || msg[1].a) {
        let result = this._constructLevel2Update(msg);
        if (result) {
          this.emit('l2update');
          this.consumer.handleUpdate(result);
        }
      } else {
        let result = this._constructLevel2Snapshot(msg);
        if (result) {
          this.emit('l2snapshot');
          this.consumer.handleSnapshot(result);
        }
      }
      return;
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
  _constructLevel2Snapshot(data) {
    const ask = data[1].as || [];
    const bid = data[1].bs || [];
    let pairName = this.chanelIdToMarket[data[0]].replace('XBT', 'BTC').replace('XDG', 'DOGE');
    let market = this._level2UpdateSubs.get(pairName);
    if (market) {
      let bids = bid.map(p => new Level2Point(p[0], p[1]));
      let asks = ask.map(p => new Level2Point(p[0], p[1]));
      if(bids[0].price >= asks[0].price){
        this._sendUnsubLevel2Updates(market);
        return new Level2Snapshot({
          exchange: 'Kraken',
          base: market.base,
          quote: market.quote,
          asks:[],
          bids:[],
        });
      }
      return new Level2Snapshot({
        exchange: 'Kraken',
        base: market.base,
        quote: market.quote,
        asks,
        bids,
      });
    } else {
      console.log(`${pairName} market not found`);
    }
  }
  _constructLevel2Update(data) {
    let ask = data[1].a || data[2].a || [];
    let bid = data[1].b || data[2].b || [];
    ask = ask.sort((a, b) => (+a[2] > +b[2] ? 1 : -1)).reverse();
    bid = bid.sort((a, b) => (+a[2] > +b[2] ? 1 : -1)).reverse();
    const updatedAsk = [];
    const updatedBid = [];
    ask.forEach(currAsk => {
      const otherAsk = find(
        ask,
        currItem => currAsk[0] === currItem[0] && (currAsk[1] !== currItem[1] || currAsk[2] !== currItem[2]),
      );
      if (otherAsk) {
        const existingAsk = find(
          updatedAsk,
          currItem => currAsk[0] === currItem[0] && (currAsk[1] !== currItem[1] || currAsk[2] !== currItem[2]),
        );
        if (!existingAsk) {
          updatedAsk.push(currAsk);
        }
      } else {
        updatedAsk.push(currAsk);
      }
    });
    bid.forEach(currBid => {
      const otherBid = find(
        bid,
        currItem => currBid[0] === currItem[0] && (currBid[1] !== currItem[1] || currBid[2] !== currItem[2]),
      );
      if (otherBid) {
        const existingBid = find(
          updatedBid,
          currItem => currBid[0] === currItem[0] && (currBid[1] !== currItem[1] || currBid[2] !== currItem[2]),
        );
        if (!existingBid) {
          updatedBid.push(otherBid);
        }
      } else {
        updatedBid.push(currBid);
      }
    });
    // const iterator = updatedAsk.length > updatedBid.length ? updatedAsk : updatedBid;
    // const checker = updatedAsk.length > updatedBid.length ? updatedBid : updatedAsk;
    // const isAsk = updatedAsk.length > updatedBid.length;
    // iterator.forEach(item => {
    //   // if (find(iterator, currItem => item[0] === currItem[0] && (item[1] !== currItem[1] || item[2] !== currItem[2]))) {
    //   //   console.log('found the same item with diff ts');
    //   // }
    //   if (isAsk) {
    //     if (find(checker, currItem => item[0] >= currItem[0])) {
    //       console.log('found the same item with diff ts on the other array');
    //     }
    //   } else {
    //     if (find(checker, currItem => item[0] <= currItem[0])) {
    //       console.log('found the same item with diff ts on the other array');
    //     }
    //   }
    //
    //   // if (find(checker, currItem => item[0] === currItem[0])) {
    //   //   console.log('found the same item with diff ts on the other array');
    //   // }
    // });
    let pairName = this.chanelIdToMarket[data[0]].replace('XBT', 'BTC').replace('XDG', 'DOGE');
    let market = this._level2UpdateSubs.get(pairName);
    if (market) {
      let bids = updatedBid.map(p => new Level2Point(p[0], p[1]));
      let asks = updatedAsk.map(p => new Level2Point(p[0], p[1]));
      return new Level2Update({
        exchange: 'Kraken',
        base: market.base,
        quote: market.quote,
        asks,
        bids,
      });
    } else {
      console.log(`${pairName} market not found`);
    }
  }

  /**
   Since Kraken doesn't send a trade id, we need to come up with a way
   to generate one on our own. The REST API include the last trade id
   which gives us the clue that it is the second timestamp + 9 sub-second
   digits.

   The WS will provide timestamps with up to 6 decimals of precision.
   The REST API only has timestamps with 4 decimal of precision.

   To maintain consistency, we're going to use the following formula:
   <integer part of unix timestamp> +
   <first 4 digits of fractional part of unix timestamp> +
   00000


   We're using the ROUND_HALF_UP method. From testing, this resulted
   in the best rounding results. Ids are in picoseconds, the websocket
   is broadcast in microsecond, and the REST results are truncated to
   4 decimals.

   This mean it is impossible to determine the rounding algorithm or
   the proper rounding to go from 6 to 4 decimals as the 6 decimals
   are being rounded from 9 which causes issues as the half
   point for 4 digit rounding
   .222950 rounds up to .2230 if the pico_ms value is > .222295000
   .222950 rounds down to .2229 if the pico_ms value is < .222295000

   Consumer code will need to account for collisions and id mismatch.
   */
  _createTradeId(unix) {
    let roundMode = Decimal.ROUND_HALF_UP;
    let [integer, frac] = unix.split(".");
    let fracResult = new Decimal("0." + frac)
      .toDecimalPlaces(4, roundMode)
      .toFixed(4)
      .split(".")[1];
    return integer + fracResult + "00000";
  }
}
module.exports = KrakenClient;
