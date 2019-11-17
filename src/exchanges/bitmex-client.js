const BasicClient = require("../basic-client");
const Trade = require("../trade");
const Level2Point = require("../level2-point");
const Level2Snapshot = require("../level2-snapshot");
const Level2Update = require("../level2-update");
const moment = require("moment");

class BitmexClient extends BasicClient {
  /**
    Documentation:
    https://www.bitmex.com/app/wsAPI
   */
  constructor() {
    super("wss://www.bitmex.com/realtime", "BitMEX");
    this.hasTrades = true;
    this.hasLevel2Updates = true;
    this.constructL2Price = true;
    this.l2PriceMap = new Map();
  }

  _sendSubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        op: "subscribe",
        args: [`trade:${remote_id}`],
      })
    );
  }

  _sendSubLevel2Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        op: "subscribe",
        args: [`orderBookL2:${remote_id}`],
      })
    );
  }

  _sendUnsubTrades(remote_id) {
    this._wss.send(
      JSON.stringify({
        op: "unsubscribe",
        args: [`trade:${remote_id}`],
      })
    );
  }

  _sendUnsubLevel2Updates(remote_id) {
    this._wss.send(
      JSON.stringify({
        op: "unsubscribe",
        args: [`orderBookL2:${remote_id}`],
      })
    );
  }

  _onMessage(msgs) {
    let message = JSON.parse(msgs);
    let { table, action } = message;

    if (table === "trade") {
      if (action !== "insert") return;
      for (let datum of message.data) {
        let remote_id = datum.symbol;
        let market = this._tradeSubs.get(remote_id);
        if (!market) continue;

        let trade = this._constructTrades(datum, market);
        this.emit("trade", trade, market);
      }
      return;
    }

    if (table === "orderBookL2") {
      /**
        From testing, we've never encountered non-uniform markets in a single
        message broadcast and will assume uniformity (though we will validate
        in the construction methods).
       */
      let remote_id = message.data[0].symbol;
      let market = this._level2UpdateSubs.get(remote_id);

      if (!market) return;

      /**
        The partial action is sent when there is a new subscription. It contains
        the snapshot of data. Updates may arrive prior to the snapshot but can
        be discarded.

        Otherwise it will be an insert, update, or delete action. All three of
        those will be handles in l2update messages.
       */
      if (action === "partial") {
        let snapshot = this._constructLevel2Snapshot(message.data, market);
        this.emit("l2snapshot", snapshot, market);
      } else {
        let update = this._constructLevel2Update(message, market);
        this.emit("l2update", update, market);
      }
      return;
    }
  }

  _constructTrades(datum, market) {
    let { size, side, timestamp, price, trdMatchID } = datum;
    let unix = moment(timestamp).valueOf();
    return new Trade({
      exchange: "BitMEX",
      base: market.base,
      quote: market.quote,
      id: market.id,
      tradeId: trdMatchID.replace(/-/g, ""),
      unix,
      side: side.toLowerCase(),
      price: price,
      amount: size,
      raw: datum, // attach the raw data incase it is needed in raw format
    });
  }

  /**
    Snapshot message are sent when an l2orderbook is subscribed to.
    This part is necessary to maintain a proper orderbook because
    BitMEX sends updates with a unique price key and does not
    include a price value. This code will maintain the price map
    so that update messages can be constructed with a price.
   */
  _constructLevel2Snapshot(data, market) {
    let asks = [];
    let bids = [];
    for (let datum of data) {
      // Construct the price lookup map for all values supplied here.
      // Per the documentation, the id is a unique value for the
      // market and the price.
      if (this.constructL2Price) {
        this.l2PriceMap.set(datum.id, datum.price);
      }

      // build the data point
      let point = new Level2Point(datum.price, datum.size, undefined, {
        id: datum.id,
      });

      // add the datapoint to the asks or bids depending if its sell or bid side
      if (datum.side === "Sell") asks.push(point);
      else bids.push(point);
    }

    // asks arrive in descending order (best ask last)
    // ccxws standardizes so that best bid/ask are array index 0
    asks = asks.reverse();

    return new Level2Snapshot({
      exchange: "BitMEX",
      base: market.base,
      quote: market.quote,
      id: market.id,
      asks,
      bids,
    });
  }

  /**
    Update messages will arrive as either insert, update, or delete
    messages. The data payload appears to be uniform for a market.
    This code will do the heavy lifting on remapping the pricing
    structure. BitMEX sends hte updates without a price and instead
    include a unique identifer for the asset and the price.

    Insert:
      {
        table: 'orderbookL2'
        action: 'insert'
        data: [{ symbol: 'XBTUSD', id: 8799198150, side: 'Sell', size: 1, price: 8018.5 }]
      }

    Update:
      {
        table: 'orderBookL2',
        action: 'update',
        data: [ { symbol: 'XBTUSD', id: 8799595600, side: 'Sell', size: 258136 } ]
      }

    Delete:
      {
        table: 'orderBookL2',
        action: 'delete',
        data: [ { symbol: 'XBTUSD', id: 8799198650, side: 'Sell' } ]
      }

    We will standardize these to the CCXWS format:
      - Insert and update will have price and size
      - Delete will have a size of 0.
   */
  _constructLevel2Update(msg, market) {
    // get the data from the message
    let data = msg.data;
    let action = msg.action;

    let asks = [];
    let bids = [];

    for (let datum of data) {
      let price;
      let size;

      /**
        In our testing, we've always seen message uniformity in the symbols.
        For performance reasons we're going to batch these into a single
        response. But if we have a piece of data that doesn't match the symbol
        we want to throw an error instead of polluting the orderbook with
        bad data.
      */
      if (datum.symbol !== market.id) {
        throw new Error(`l2update symbol mismatch, expected ${market.id}, got ${datum.symbol}`);
      }

      // Find the price based on the price identifier
      if (this.constructL2Price) {
        switch (action) {
          // inserts will contain the price, we need to set these in the map
          // we can also directly use the price value
          case "insert":
            price = datum.price;
            this.l2PriceMap.set(datum.id, price);
            break;
          // update will require us to look up the price from the map
          case "update":
            price = this.l2PriceMap.get(datum.id);
            break;
          // price will require us to look up the price from the map
          // we also will want to delete the map value since it's
          // no longer needed
          case "delete":
            price = this.l2PriceMap.get(datum.id);
            this.l2PriceMap.delete(datum.id);
            break;
        }
      }

      // Find the size
      switch (action) {
        case "insert":
        case "update":
          size = datum.size;
          break;
        case "delete":
          size = (0);
          break;
      }

      if (!price) {
        console.warn("unknown price", datum);
      }

      // Construct the data point
      let point = new Level2Point(price, size, undefined, { type: action, id: datum.id });

      // Insert into ask or bid
      if (datum.side === "Sell") asks.push(point);
      else bids.push(point);
    }

    // asks arrive in descending order (best ask last)
    // ccxws standardizes so that best bid/ask are array index 0
    asks = asks.reverse();

    return new Level2Update({
      exchange: "BitMEX",
      base: market.base,
      quote: market.quote,
      id: market.id,
      asks,
      bids,
    });
  }
}

module.exports = BitmexClient;
