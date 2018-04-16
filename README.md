# CryptoCurrency eXchange WebSockets
[![CircleCI](https://circleci.com/gh/altangent/ccxws/tree/master.svg?style=shield)](https://circleci.com/gh/altangent/ccxws/tree/master)
[![Coverage Status](https://coveralls.io/repos/github/altangent/ccxws/badge.svg?branch=ci)](https://coveralls.io/github/altangent/ccxws?branch=ci)

A JavaScript library for connecting to realtime data feeds on cryptocurrency exchanges. 

CCXWS is intended for use by individuals or members of institutions that wish to connect to many exchanges at one time using a standardized eventing interface.  

The CCXWS socket client performs automatic reconnection when there are disconnections. 

CCXWS uses similar market structures to those generated by the CCXT library to aid in interoperability between the RESTful interfaces provided by CCXT and the realtime interfaces provided by CCXWS.

## Getting Started

Install ccxws
```bash
npm install ccxws
```

Create a new client for an exchange. Subscribe to the events that you want to listen to by supplying a market.
```javascript
const ccxws = require('ccxws');
const binance = new ccxws.Binance();

binance.on('trade', trade => console.log(trade));
binance.subcribeTrades({
  id: 'ADA_BTC',
  base: 'ADA',
  quote: 'BTC'
});
```

## API
Importing `ccxws` will allow you to create an instance of the client for the exchange you want to access.  For example:
```javascript
const ccxws = require('ccxws');
const binance = new ccxws.Binance();
const gdax = new ccxws.GDAX();
```


### Class - Market
Markets are used as input to many of the client functions.  Markets can be generated and stored by you the developer or loaded from the CCXT library.

The following properties are used by CCXWS. 
* string `id` - the identifier used by the remote exchange
* string `base` - the normalized base symbol for the market
* string `quote` - the normalized quote symbol for the market


### Class - Trade
The trade class is the result of a `trade` event emitted from a client. This object includes the following properties

#### Properties
* string `exchange` - the name of the exchange 
* string `base` - the normalized base symbol for the market
* string `quote` - the normalized quote symbol for the market
* string `marketId` - the normalize market id, ie: `LTC/BTC`
* string `fullId` - the normalized market id prefixed with the exchange, ie: `Binance:LTC/BTC`
* number `tradeId` - the unique trade identifer from the exchanges feed
* number `unix` - the unix time stamp in seconds for when the trade executed
* number `price` - the price that the trade executed at
* number `amount` - the amount that was traded (positive means the buyer was the taker, negative means the seller was the taker)

### Class - Client 
A websocket client that connects to a specific exchange. There is an implementation of this class for each exchange that governs the specific rules for managing the realtime connections to the exchange.

#### Events
##### trade
Fired when a trade is received. Returns an instance of a `Trade`.

#### Methods
##### subscribeTrades(market)
Subscribes to a trade feed for the specified market. This method will cause the client to emit `trade` events that have a payload of the `Trade` object. 

##### unsubscribeTrades(market)
Unsubscribes from a trade feed for the specified market. *For some exchanges, calling unsubscribe may cause a temporary disruption in all feeds.

## Exchanges

|Exchange|Class|Trades|Orderbook| 
|--------|-----|------|---------|
|Binance|Binance|:+1:||
|Bitfinex|Bitfinex|:+1:||
|Bittrex|Bittrex|:+1:||
|GDAX|GDAX|:+1:||
|Poloniex|Poloniex|:+1:||
