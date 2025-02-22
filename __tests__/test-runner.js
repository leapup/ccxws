const { expect } = require("chai");

module.exports = {
  testClient,
};

function testClient(spec) {
  if (spec.skip) return;

  describe(spec.clientName, () => {
    let state = {};

    before(() => {
      state.client = spec.clientFactory();
      spec.marketIdList = spec.markets.map(p => p.id);
      spec.marketBaseList = spec.markets.map(p => p.base);
      spec.marketQuoteList = spec.markets.map(p => p.quote);
    });

    describe("capabilities", () => {
      it(`should ${spec.hasTickers ? "support" : "not support"} tickers`, () => {
        expect(state.client.hasTickers).to.equal(spec.hasTickers);
      });

      it(`should ${spec.hasTrades ? "support" : "not support"} trades`, () => {
        expect(state.client.hasTrades).to.equal(spec.hasTrades);
      });

      it(`should ${spec.hasCandles ? "support" : "not support"} candles`, () => {
        expect(state.client.hasCandles).to.equal(spec.hasCandles);
      });

      it(`should ${spec.hasLevel2Snapshots ? "support" : "not support"} level2 snapshots`, () => {
        expect(state.client.hasLevel2Snapshots).to.equal(spec.hasLevel2Snapshots);
      });

      it(`should ${spec.hasLevel2Updates ? "support" : "not support"} level2 updates`, () => {
        expect(state.client.hasLevel2Updates).to.equal(spec.hasLevel2Updates);
      });

      it(`should ${spec.hasLevel3Snapshots ? "support" : "not support"} level3 snapshots`, () => {
        expect(state.client.hasLevel3Snapshots).to.equal(spec.hasLevel3Snapshots);
      });

      it(`should ${spec.hasLevel3Updates ? "support" : "not support"} level3 updates`, () => {
        expect(state.client.hasLevel3Updates).to.equal(spec.hasLevel3Updates);
      });
    });

    if (spec.hasTickers && spec.ticker) {
      testTickers(spec, state);
    }

    if (spec.hasTrades && spec.trade) {
      testTrades(spec, state);
    }

    if (spec.hasCandles && spec.candle) {
      testCandles(spec, state);
    }

    if (spec.hasLevel2Snapshots && spec.l2snapshot) {
      testLevel2Snapshots(spec, state);
    }

    if (spec.hasLevel2Updates && spec.l2update) {
      testLevel2Updates(spec, state);
    }

    if (spec.hasLevel3Updates && spec.l3update) {
      testLevel3Updates(spec, state);
    }

    describe("close", () => {
      it("should close client", () => {
        state.client.close();
      });
    });
  });

  describe(spec.clientName + " events", () => {
    let client;
    let actual = [];
    before(() => {
      client = spec.clientFactory();
    });

    beforeEach(() => {
      actual = [];
    });

    afterEach(() => {
      client.removeAllListeners();
    });

    function pushEvent(name) {
      return () => {
        actual.push(name);
      };
    }

    function assertEvents(expected, done) {
      return () => {
        try {
          expect(actual).to.deep.equal(expected);
          done();
        } catch (ex) {
          done(ex);
        }
      };
    }

    if (spec.testConnectEvents) {
      it("subscribe triggers `connecting` > `connected`", done => {
        client.on("connecting", pushEvent("connecting"));
        client.on("connected", pushEvent("connected"));
        client.on("connected", assertEvents(["connecting", "connected"], done));
        client.subscribeTrades(spec.markets[0]);
      }).timeout(5000);
    }

    if (spec.testDisconnectEvents) {
      it("disconnection triggers `disconnected` > `connecting` > `connected`", done => {
        client.on("disconnected", pushEvent("disconnected"));
        client.on("connecting", pushEvent("connecting"));
        client.on("connected", pushEvent("connected"));
        client.on("connected", assertEvents(["disconnected", "connecting", "connected"], done));

        let p = client._wss
          ? Promise.resolve(client._wss)
          : Promise.resolve(spec.getEventingSocket(client, spec.markets[0]));

        p.then(smartws => {
          smartws._retryTimeoutMs = 1000;
          smartws._wss.close(); // simulate a failure by directly closing the underlying socket
        });
      }).timeout(5000);
    }

    if (spec.testReconnectionEvents) {
      it("reconnects triggers `reconnecting` > `closing` > `closed` > `connecting` > `connected`", done => {
        client.on("reconnecting", pushEvent("reconnecting"));
        client.on("closing", pushEvent("closing"));
        client.on("closed", pushEvent("closed"));
        client.on("connecting", pushEvent("connecting"));
        client.on("connected", pushEvent("connected"));
        client.on(
          "connected",
          assertEvents(["reconnecting", "closing", "closed", "connecting", "connected"], done)
        );
        client.reconnect();
      }).timeout(5000);
    }

    if (spec.testCloseEvents) {
      it("close triggers `closing` > `closed`", done => {
        client.on("reconnecting", () => {
          throw new Error("should not emit reconnecting");
        });
        client.on("closing", pushEvent("closing"));
        client.on("closed", pushEvent("closed"));
        client.on("closed", assertEvents(["closing", "closed"], done));
        client.close();
      }).timeout(5000);
    }
  });
}

function testTickers(spec, state) {
  describe("subscribeTicker", () => {
    let result = {};
    let client;

    before(() => {
      client = state.client;
    });

    it("should subscribe and emit a ticker", done => {
      for (let market of spec.markets) {
        client.subscribeTicker(market);
      }
      client.on("ticker", (ticker, market) => {
        result.ready = true;
        result.ticker = ticker;
        result.market = market;
        client.removeAllListeners("ticker");
        done();
      });
    })
      .timeout(60000)
      .retries(3);

    it("should unsubscribe from tickers", () => {
      for (let market of spec.markets) {
        client.unsubscribeTicker(market);
      }
    });

    describe("results", () => {
      before(function() {
        if (!result.ready) return this.skip();
      });

      it("market should be the subscribing market", () => {
        expect(result.market).to.be.oneOf(spec.markets);
      });

      it("ticker.exchange should be the exchange name", () => {
        expect(result.ticker.exchange).to.equal(spec.exchangeName);
      });

      it("ticker.base should match market.base", () => {
        expect(result.ticker.base).to.be.oneOf(spec.marketBaseList);
      });

      it("ticker.quote should match market.quote", () => {
        expect(result.ticker.quote).to.be.oneOf(spec.marketQuoteList);
      });

      if (spec.ticker.hasTimestamp) {
        testTimestampMs(result, "ticker.timestamp");
      } else {
        testUndefined(result, "ticker.timestamp");
      }

      let numberProps = [
        [spec.ticker.hasLast, "ticker.last"],
        [spec.ticker.hasOpen, "ticker.open"],
        [spec.ticker.hasHigh, "ticker.high"],
        [spec.ticker.hasLow, "ticker.low"],
        [spec.ticker.hasVolume, "ticker.volume"],
        [spec.ticker.hasQuoteVolume, "ticker.quoteVolume"],
        [spec.ticker.hasChange, "ticker.change"],
        [spec.ticker.hasChangePercent, "ticker.changePercent"],
        [spec.ticker.hasBid, "ticker.bid"],
        [spec.ticker.hasBidVolume, "ticker.bidVolume"],
        [spec.ticker.hasAsk, "ticker.ask"],
        [spec.ticker.hasAskVolume, "ticker.askVolume"],
      ];

      for (let [hasSpec, prop] of numberProps) {
        if (hasSpec) {
          testNumberString(result, prop);
        } else {
          testUndefined(result, prop);
        }
      }
    });
  });
}

function testTrades(spec, state) {
  describe("subscribeTrades", () => {
    let result = {};
    let client;

    before(() => {
      client = state.client;
    });

    it("should subscribe and emit a trade", done => {
      for (let market of spec.markets) {
        client.subscribeTrades(market);
      }
      client.on("trade", (trade, market) => {
        result.ready = true;
        result.trade = trade;
        result.market = market;
        client.removeAllListeners("trade");
        done();
      });
    })
      .timeout(60000)
      .retries(3);

    it("should unsubscribe from trades", () => {
      for (let market of spec.markets) {
        client.unsubscribeTrades(market);
      }
    });

    describe("results", () => {
      before(function() {
        if (!result.ready) return this.skip();
      });

      it("market should be the subscribing market", () => {
        expect(result.market).to.be.oneOf(spec.markets);
      });

      it("trade.exchange should be the exchange name", () => {
        expect(result.trade.exchange).to.equal(spec.exchangeName);
      });

      it("trade.base should match market.base", () => {
        expect(result.trade.base).to.be.oneOf(spec.marketBaseList);
      });

      it("trade.quote should match market.quote", () => {
        expect(result.trade.quote).to.be.oneOf(spec.marketQuoteList);
      });

      if (spec.trade.hasTradeId) {
        testString(result, "trade.tradeId");
      } else {
        testUndefined(result, "trade.tradeId");
      }

      if (spec.trade.tradeIdPattern) {
        it(`trade.tradeId should match pattern ${spec.trade.tradeIdPattern}`, () => {
          expect(result.trade.tradeId).to.match(spec.trade.tradeIdPattern);
        });
      }

      testTimestampMs(result, "trade.unix");

      it("trade.side should be either 'buy' or 'sell'", () => {
        expect(result.trade.side).to.match(/buy|sell/);
      });

      testNumberString(result, "trade.price");
      testNumberString(result, "trade.amount");

      if (spec.trade.tests) {
        spec.trade.tests(spec, result);
      }
    });
  });
}

function testCandles(spec, state) {
  describe("subscribeCandles", () => {
    let result = {};
    let client;

    before(() => {
      client = state.client;
    });

    it("should subscribe and emit a candle", done => {
      for (let market of spec.markets) {
        client.subscribeCandles(market);
      }
      client.on("candle", (candle, market) => {
        result.ready = true;
        result.market = market;
        result.candle = candle;
        client.removeAllListeners("candle");
        done();
      });
    })
      .timeout(60000)
      .retries(3);

    it("should unsubscribe from candles", () => {
      for (let market of spec.markets) {
        client.unsubscribeCandles(market);
      }
    });

    describe("results", () => {
      before(function() {
        if (!result.ready) return this.skip();
      });

      it("market should be the subscribing market", () => {
        expect(result.market).to.be.oneOf(spec.markets);
      });

      testCandleResult(spec, result);
    });
  });
}

function testCandleResult(spec, result) {
  testTimestampMs(result, `candle.timestampMs`);
  testNumberString(result, `candle.open`);
  testNumberString(result, `candle.high`);
  testNumberString(result, `candle.low`);
  testNumberString(result, `candle.close`);
  testNumberString(result, `candle.volume`);
}

function testLevel2Snapshots(spec, state) {
  describe("subscribeLevel2Snapshots", () => {
    let result = {};
    let client;

    before(() => {
      client = state.client;
    });

    it("should subscribe and emit a l2snapshot", done => {
      for (let market of spec.markets) {
        client.subscribeLevel2Snapshots(market);
      }
      client.on("l2snapshot", (snapshot, market) => {
        result.ready = true;
        result.snapshot = snapshot;
        result.market = market;
        client.removeAllListeners("l2snapshot");
        done();
      });
    })
      .timeout(60000)
      .retries(3);

    it("should unsubscribe from l2snapshot", () => {
      for (let market of spec.markets) {
        client.unsubscribeLevel2Snapshots(market);
      }
    });

    describe("results", () => {
      before(function() {
        if (!result.ready) return this.skip();
      });

      it("market should be the subscribing market", () => {
        expect(result.market).to.be.oneOf(spec.markets);
      });

      testLevel2Result(spec, result, "snapshot");
    });
  });
}

function testLevel2Updates(spec, state) {
  describe("subscribeLevel2Updates", () => {
    let result = {};
    let client;

    before(() => {
      client = state.client;
    });

    it("should subscribe and emit a l2update", done => {
      for (let market of spec.markets) {
        client.subscribeLevel2Updates(market);
      }
      client.on("l2snapshot", (snapshot, market) => {
        result.ready = true;
        result.snapshot = snapshot;
        result.market = market;
      });
      client.on("l2update", (update, market) => {
        result.update = update;
        result.market = market;
        if (
          // check if done override method exists method in spec
          (!spec.l2update.done || spec.l2update.done(spec, result, update, market)) &&
          // check if we require a snapshot
          (!spec.l2update.hasSnapshot || result.snapshot)
        ) {
          result.ready = true;
          client.removeAllListeners("l2update");
          done();
        }
      });
    })
      .timeout(60000)
      .retries(3);

    it("should unsubscribe from l2update", () => {
      for (let market of spec.markets) {
        client.unsubscribeLevel2Updates(market);
      }
    });

    describe("results", () => {
      before(function() {
        if (!result.ready) {
          this.skip();
          return;
        }
      });

      it("market should be the subscribing market", () => {
        expect(result.market).to.be.oneOf(spec.markets);
      });

      if (spec.l2update.hasSnapshot) {
        testLevel2Result(spec, result, "snapshot");
      }

      testLevel2Result(spec, result, "update");

      if (spec.l2update.tests) {
        spec.l2update.tests(spec, result);
      }
    });
  });
}

function testLevel2Result(spec, result, type) {
  it(`${type}.exchange should be the exchange name`, () => {
    expect(result[type].exchange).to.equal(spec.exchangeName);
  });

  it(`${type}.base should match market.base`, () => {
    expect(result[type].base).to.be.oneOf(spec.marketBaseList);
  });

  it(`${type}.quote should match market.quote`, () => {
    expect(result[type].quote).to.be.oneOf(spec.marketQuoteList);
  });

  if (spec[`l2${type}`].hasTimestampMs) {
    testTimestampMs(result, `${type}.timestampMs`);
  } else {
    testUndefined(result, `${type}.timestampMs`);
  }

  if (spec[`l2${type}`].hasSequenceId) {
    testPositiveNumber(result, `${type}.sequenceId`);
  } else {
    testUndefined(result, `${type}.sequenceId`);
  }

  it(`${type}.bid/ask.price should be a string`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).price;
    expect(actual).to.be.a("string");
  });

  it(`${type}.bid/ask.price should parse to a number`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).price;
    expect(parseFloat(actual)).to.not.be.NaN;
  });

  it(`${type}.bid/ask.size should be a string`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).size;
    expect(actual).to.be.a("string");
  });

  it(`${type}.bid/ask.size should parse to a number`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).size;
    expect(parseFloat(actual)).to.not.be.NaN;
  });

  if (spec[`l2${type}`].hasCount) {
    it(`${type}.bid/ask.count should be a string`, () => {
      let actual = (result[type].bids[0] || result[type].asks[0]).count;
      expect(actual).to.be.a("string");
    });

    it(`${type}.bid/ask.count should parse to a number`, () => {
      let actual = (result[type].bids[0] || result[type].asks[0]).count;
      expect(parseFloat(actual)).to.not.be.NaN;
    });
  } else {
    it(`${type}.bid/ask.count should undefined`, () => {
      let actual = (result[type].bids[0] || result[type].asks[0]).count;
      expect(actual).to.be.undefined;
    });
  }
}

function testLevel3Updates(spec, state) {
  describe("subscribeLevel3Updates", () => {
    let result = {
      ready: false,
    };
    let client;

    before(() => {
      client = state.client;
    });

    it("should subscribe and emit a l3update", done => {
      for (let market of spec.markets) {
        client.subscribeLevel3Updates(market);
      }
      client.on("l3snapshot", (snapshot, market) => {
        result.snapshot = snapshot;
        result.market = market;
      });
      client.on("l3update", (update, market) => {
        result.update = update;
        result.market = market;
        if (
          // check if done override method exists method in spec
          (!spec.l3update.done || spec.l3update.done(spec, result, update, market)) &&
          // check if we require a snapshot
          (!spec.l3update.hasSnapshot || result.snapshot)
        ) {
          result.ready = true;
          client.removeAllListeners("l3update");
          done();
        }
      });
    })
      .timeout(60000)
      .retries(3);

    it("should unsubscribe from l3update", () => {
      for (let market of spec.markets) {
        client.unsubscribeLevel3Updates(market);
      }
    });

    describe("results", () => {
      before(function() {
        if (!result.ready) return this.skip();
      });

      it("market should be the subscribing market", () => {
        expect(result.market).to.be.oneOf(spec.markets);
      });

      if (spec.l3update.hasSnapshot) {
        testLevel3Result(spec, result, "snapshot");
      }

      testLevel3Result(spec, result, "update");
    });
  });
}

function testLevel3Result(spec, result, type) {
  it(`${type}.exchange should be the exchange name`, () => {
    expect(result[type].exchange).to.equal(spec.exchangeName);
  });

  it(`${type}.base should match market.base`, () => {
    expect(result[type].base).to.be.oneOf(spec.marketBaseList);
  });

  it(`${type}.quote should match market.quote`, () => {
    expect(result[type].quote).to.be.oneOf(spec.marketQuoteList);
  });

  if (spec[`l3${type}`].hasTimestampMs) {
    testTimestampMs(result, `${type}.timestampMs`);
  } else {
    testUndefined(result, `${type}.timestampMs`);
  }

  if (spec[`l3${type}`].hasSequenceId) {
    testPositiveNumber(result, `${type}.sequenceId`);
  } else {
    testUndefined(result, `${type}.sequenceId`);
  }

  it(`${type}.bid/ask.orderId should be a string`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).orderId;
    expect(actual).to.be.a("string");
  });

  if (spec[`l3${type}`].orderIdPattern) {
    it(`${type}.bid/ask.orderId should match ${spec[`l3${type}`].orderIdPattern}`, () => {
      let actual = (result[type].bids[0] || result[type].asks[0]).orderId;
      expect(actual).to.match(spec[`l3${type}`].orderIdPattern);
    });
  }

  it(`${type}.bid/ask.price should be a string`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).price;
    expect(actual).to.be.a("string");
  });

  it(`${type}.bid/ask.price should parse to a number`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).price;
    expect(parseFloat(actual)).to.not.be.NaN;
  });

  it(`${type}.bid/ask.size should be a string`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).size;
    expect(actual).to.be.a("string");
  });

  it(`${type}.bid/ask.size should parse to a number`, () => {
    let actual = (result[type].bids[0] || result[type].asks[0]).size;
    expect(parseFloat(actual)).to.not.be.NaN;
  });
}

//////////////////////////////////////////////////////

function testPositiveNumber(result, prop) {
  it(`${prop} should be a number`, () => {
    let actual = deepValue(result, prop);
    expect(actual).to.be.a("number");
  });

  it(`${prop} should be positive`, () => {
    let actual = deepValue(result, prop);
    expect(actual).to.be.greaterThan(0);
  });
}

function testNumberString(result, prop) {
  it(`${prop} should be a string`, () => {
    let actual = deepValue(result, prop);
    expect(actual).to.be.a("string");
  });

  it(`${prop} should parse to a number`, () => {
    let actual = deepValue(result, prop);
    expect(parseFloat(actual)).to.not.be.NaN;
  });
}

function testUndefined(result, propPath) {
  it(`${propPath} should be undefined`, () => {
    let actual = deepValue(result, propPath);
    expect(actual).to.be.undefined;
  });
}

function testTimestampMs(result, propPath) {
  it(`${propPath} should be a number`, () => {
    let actual = deepValue(result, propPath);
    expect(actual).to.be.a("number");
  });

  it(`${propPath} should be in milliseconds`, () => {
    let actual = deepValue(result, propPath);
    expect(actual).to.be.greaterThan(1531677480000);
  });
}

function testString(result, propPath) {
  it(`${propPath} should be a string`, () => {
    let actual = deepValue(result, propPath);
    expect(actual).to.be.a("string");
  });

  it(`${propPath} should not be empty`, () => {
    let actual = deepValue(result, propPath);
    expect(actual).to.not.equal("");
  });
}

function deepValue(obj, path) {
  let parts = path.split(".");
  let result = obj;
  for (let part of parts) {
    result = result[part];
  }
  return result;
}
