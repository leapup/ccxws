class Ticker {
  constructor({
    exchange,
    base,
    quote,
    timestamp,
    last,
    open,
    high,
    low,
    volume,
    quoteVolume,
    change,
    changePercent,
    bid,
    bidVolume,
    ask,
    askVolume,
  }) {
    this.exchange = exchange;
    this.base = base;
    this.quote = quote;
    this.timestamp = timestamp;
    this.last = last;
    this.open = open;
    this.high = high;
    this.low = low;
    this.volume = volume;
    this.quoteVolume = quoteVolume;
    this.change = change;
    this.changePercent = changePercent;
    this.bid = bid;
    this.bidVolume = bidVolume;
    this.ask = ask;
    this.askVolume = askVolume;
  }

  get fullId() {
    return `${this.exchange}:${this.base}/${this.quote}`;
  }
}

module.exports = Ticker;
