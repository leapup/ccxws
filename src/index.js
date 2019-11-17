const bibox = require("./exchanges/bibox-client");
const binance = require("./exchanges/binance-client");
const bitfinex = require("./exchanges/bitfinex-client");
const bitflyer = require("./exchanges/bitflyer-client");
const bitmex = require("./exchanges/bitmex-client");
const bitstamp = require("./exchanges/bitstamp-client");
const bittrex = require("./exchanges/bittrex-client");
const cex = require("./exchanges/cex-client");
const gdax = require("./exchanges/coinbasepro-client");
const coinex = require("./exchanges/coinex-client");
const ethfinex = require("./exchanges/ethfinex-client");
const gateio = require("./exchanges/gateio-client");
const gemini = require("./exchanges/gemini-client");
const hitbtc = require("./exchanges/hitbtc-client");
const huobipro = require("./exchanges/huobi-client");
const kraken = require("./exchanges/kraken-client");
const lbank = require("./exchanges/lbank-client");
const okex = require("./exchanges/okex-client");
const poloniex = require("./exchanges/poloniex-client");
const upbit = require("./exchanges/upbit-client");
const zb = require("./exchanges/zb-client");

module.exports = {
  // export all legacy exchange names
  Bibox: bibox,
  Binance: binance,
  Bitfinex: bitfinex,
  Bitflyer: bitflyer,
  BitMEX: bitmex,
  Bitstamp: bitstamp,
  Bittrex: bittrex,
  Ethfinex: ethfinex,
  Gateio: gateio,
  Gemini: gemini,
  HitBTC: hitbtc,
  huobipro,
  Kraken: kraken,
  OKEx: okex,
  Poloniex: poloniex,
  Upbit: upbit,

  // export all exchanges
  bibox,
  binance,
  bitfinex,
  bitflyer,
  bitmex,
  bitstamp,
  bittrex,
  cex,
  gdax,
  coinex,
  ethfinex,
  gateio,
  gemini,
  hitbtc,
  kraken,
  lbank,
  okex,
  poloniex,
  upbit,
  zb,

  // export all types
  Auction: require("./auction"),
  BasicClient: require("./basic-client"),
  BlockTrade: require("./block-trade"),
  Level2Point: require("./level2-point"),
  Level2Snapshot: require("./level2-snapshot"),
  Level2Update: require("./level2-update"),
  Level3Point: require("./level3-point"),
  Level3Snapshot: require("./level3-snapshot"),
  Level3Update: require("./level3-update"),
  SmartWss: require("./smart-wss"),
  Ticker: require("./ticker"),
  Trade: require("./trade"),
  Watcher: require("./watcher"),
};
