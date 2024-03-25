import uuid from "uuid";

class State {
  constructor() {
    this.auctions = {};
    this.bids = {};
  }

  /*
   * adds an auction to the state
   */
  addAuction(item, price) {
    let auction = newAuction(item, price);
    this.auctions[auction.id] = auction;
  }

  /*
   * gets an auction from the state.
   */
  getAuction(auctionId) {
    return this.auctions[auctionId];
  }

  /*
   * adds a bid to the state.
   */
  addBid(auctionId, price) {
    let bid = newBid(auctionId, price);
    this.bids[bid.id] = bid;
  }

  /*
   * retrieves bid from the state.
   */
  getBid(bidId) {
    return this.bids[bidId];
  }
}

function newAuction(item, price) {
  return {
    id: uuid.v4(),
    item,
    price,
  };
}

function newBid(auctionId, price) {
  return {
    id: uuid.v4(),
    auctionId,
    price,
  };
}
