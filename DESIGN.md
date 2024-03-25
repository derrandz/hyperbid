# Design Document

## Assumptions and Considerations

Here are some assumptions and considerations we adoped to limit the scope of the task:

1. Auctions will only support one item only. (_i.e: no multiple items per auction_)
2. Peers will only bid on open auctions that exist:
   We will not handle scenarios where peers would to bid on a closed auction, or an auction that doesn't exist. (_we would simply ignore these edge cases_)
3. Peers will place bids that are greater than or equal to the announced auction price:
   We will not handle the case of a peer trying to bid with an amount less than the current highest bid.
4. Only peers that open auctions can close them (_i,e: decide who to sell to_), we will assume no malicious behavior:
   We will ignore write permissions etc... (_a little more on this below on the database choice section_)

## Design

- Peers will talk to each other over a pusub-like ([(details about pubsub)](#pusub) p2p network powered by Hyperswarm RPC (_i.e: peers will be clients and servers at the same time_)
- Peers will have dedicated RPC methods to synchronize state with other peers by sharing their db's advertised key
- The network will have (pubsub) topics, and peers will subscribe to well known network-wide topics, and these topics will be:

  - `auctions`: _advertises the event of an auction being opened or closed_
  - `bids`: _advertises the event of a bid being made_

  all topics will receive messages respecting the same schema of an event/transaction, which is:

  ```json
  {
    "type": "auction_opened|bid|auction_closed",
    "payload": {
      "auctionId": "string",
      "bidId": "string",
      "actor": "string", // peerId, representing bidder, auctioneer or the eventual buyer that wins the auction.
      "item": "object",
      "amount": "number",
      "timestamp": "number"
    }
  }
  ```

- Peers will have replicated p2p databases to store the state of the "network" which comprises of auctions and bids, we will use a single key-value database with the following keys:

  - `auctions`: _stores the state of all auctions_
  - `bids:{auctionId}`: _stores the bids history for a particular auction_
    (_caveat: another -arguably- intuitive and potential design one might think of is using hypercore as an event store/log and abstract all actions on the network in the form of transactions and follow the logic of a blockchain, which will help us maintain "state integrity", but this will complicate processing the state + would require some consensus mechanism + we don't have a requirement for maintaining "world state history" -if you like-, thus we discarded this option._)

- The natural order of events should be: "auction_opened" -> "bid" -> "auction_closed", examples of events per type:

  - `auction_opened`:
    ```json
    {
      "type": "auction_opened",
      "payload": {
        "auctionId": "39da42fasd9af-a23r12rsdf-239sdfsdf-324123dfs",
        "actor": "afa09de29bb6e60d878747de50cb3002b0c1232c193863be0f61f6ccf35447ad",
        "item": { // example with some hypothetical NFT on eth that lives on ipfs
          "name": "item1",
          "description": "description1"
          "type": "NFT",
          "data": {
            "network": "ethereum",
            "address": "0x1234567890",
            "content": {
              "ipfs": {
                "hash": "QmZ4tvcZ",
                "url": "https://ipfs.io/ipfs/QmZ4tvcZ
              }
            }
          }
        },
        "amount": 100,
        "timestamp": 1234567890
      }
    }
    ```
  - `bid`:
    ```json
    {
      "type": "bid",
      "payload": {
        "auctionId": "39da42fasd9af-a23r12rsdf-239sdfsdf-324123dfs",
        "bidId": "a23r12rsdf-239sdfsdf-324123dfs-39da42fasd9af",
        "actor": "b4s49dv29bb6e60d878747de50cb3002b0c1232c193863be0f61f6ccf356000s",
        "amount": 110,
        "timestamp": 1234567891
      }
    }
    ```
  - `auction_closed`:
    ```json
    {
      "type": "auction_closed",
      "payload": {
        "auctionId": "39da42fasd9af-a23r12rsdf-239sdfsdf-324123dfs",
        "bidId": "a23r12rsdf-239sdfsdf-324123dfs-39da42fasd9af", // winning bid
        "actor": "b4s49dv29bb6e60d878747de50cb3002b0c1232c193863be0f61f6ccf356000s", // owner of the winning bid, redundancy for ease
        "timestamp": 1234567892
        // item can be retrieved from auction
        // amount can be retrieved from bid
      }
    }
    ```

- To open an auction, a peer will create an auction instance on its database, and then broadcast an `auction_opened` event to the network.
  Other peers will listen to this event to learn that a new auction has been opened, and that they can retrieve it from their p2p replicated database using the id they received.
- To bid on an auction, a peer will create a bid instance on its database, and then broadcast a `bid` event to the network.
- To close an auction, a peer will broadcast an `auction_closed` event to the network.
- Peers joining later will be able to retrieve the state of the network through their replicated hyperbee instance, and will continue to participate by listening to the events on the network.

### Implementation details

- Each peer will be composed of a swarm instance and a hyperbee instance.
- Each peer will join topics: `auctions` and `bids`
- Each peer will listen to the `auctions` topic for `auction_opened` and `auction_closed` events
- Each peer will listen to the `bids` topic for `bid` events
- Peers will broadcast events to topics `auctions` and `bids` when they open an auction, bid on an auction or close an auction.
- Each peer will implement a rpc server to listen to events on the topics they are subscribed to.
- Each peer will define a "state-height" RPC method to retrieve the current state of the network.
- Each peer will define a "state-sync" RPC method to retrieve the state of the network from a given height.
- Any later joiner will ask all peers for their heights, then fetch state from the peer with the highest height. (height = core's height. This feels a bit naive, I am not sure if the core's height translates to the latest network state... for now will keep as a filler)

#### Listening And Broadcasting events to topics

We will follow a simplistic approach to achieve a pubsub behavior.

We will use `hyperswarm` to retrieve an maintain peerlists for each topic. (_`swarm.peers` + some filtering_)
We will use the `hyperswarm/rpc` module to listen and broadcast events to topics, such that:

- Listen: all peers will maintain rpc-request handlers in the name of the topics they are subscribed to. (_i.e: if a peer is listening for topics `auctions` and `bids`, it will have two rpc server method handlers: `topic:auctions` and `topic:bids`_)
- When a peer wants to broadcast an event to a topic, it will use the `hyperswarm/rpc` module to send an rpc request with the topic as the method's name, to all peers in the peerlist of the topic, with the event as the payload.

#### Replicating the state of the network

We will use `hyperbee` to replicate the state of the network. Each peer will have a `hyperbee` instance that will be used to store the state of the network. The state of the network will be stored in the following keys:

- `auctions`: a key-value store where the key is the auction id and the value is the auction object.
- `bids:{auctionId}`: a key-value store where the key is the bid id and the value is the bid object.

When a peer joins the network, it will replicate the state of the network by syncing its `hyperbee` instance with the `hyperbee` instances of the peer with the highest height in the network.
The replicated "core" will be discarded afterwards.

### Components Design

The design will be composed of four main components:

- the `Peer` class
- the `Database` class
- the `State` class
- the `App` class

#### Peer

The `Peer` class will represent a peer in the network. It will have the following properties and methods:

- Properties:

  - `swarm`: a `hyperswarm` instance that will be used to maintain the peerlist for each topic.
  - `rpc`: a `hyperswarm/rpc` instance that will be used to listen and broadcast events to topics.
  - `hyperbee`: a `hyperbee` instance that will be used to store the state of the network.
  - `topics`: an array of topics that the peer is subscribed to.

- Methods:
  - `start()` : a method that will start the peer by joining the swarm and syncing the state of the network.
  - `listen(topic, handler)`: a method that will make the peer listen to events on a topic by adding an rpc request handler with the topic as the method's name as well as joining the swarm topic to discover peers in the topic.
  - `leave(topic)`: a method that will make the peer leave a topic by removing the rpc request handler with the topic as the method's name and leaving the swarm topic.
  - `broadcast(topic, event)`: a method that will make the peer broadcast an event to a topic by sending an rpc request with the topic as the method's name and the event as the payload to all peers in the peerlist of the topic.
  - `syncState()`: a method that will make the peer sync its `hyperbee` instance with the `hyperbee` instances of other peers in the network.

#### State

The `State` class will represent the state of the peer in the auction app. It will have the following properties and methods:

- Properties:

  - `auctions`: a key-value store where the key is the auction id and the value is the auction object.
  - `bids`: a key-value store where the key is the bid id and the value is the bid object.

- Methods:

  - `addAuction(auction)`: a method that will add an auction to the state.
  - `getAuction(auctionId)`: a method that will get an auction from the state.
  - `addBid(bid)`: a method that will add a bid to the state.
  - `getBid(bidId)`: a method that will get a bid from the state.

#### App

The `App` class will represent the application that will deal with state and manage auction logic. It will have the following properties and methods:

- Properties:

  - `peer`: a `Peer` instance that will represent the peer in the network.
  - `state`: an object that will store the state of the network.

- Methods:
  - `openAuction(auction)`: a method that will open an auction by creating an auction instance on the `hyperbee` instance of the peer and broadcasting an `auction_opened` event to the network.
  - `bidOnAuction(auctionId, bid)`: a method that will bid on an auction by creating a bid instance on the `hyperbee` instance of the peer and broadcasting a `bid` event to the network.
  - `closeAuction(auctionId)`: a method that will close an auction by broadcasting an `auction_closed` event to the network.
  - `syncState()` : a method that will sync the state of the network by syncing the `hyperbee` instance of the peer with the `hyperbee` instances of other peers in the network.

#### Testing

We will test the implementation by creating a network of peers and having them open auctions, bid on auctions and close auctions. We will also test the replication of the state of the network by having peers join the network at different times and syncing their `hyperbee` instances with the `hyperbee` instances of other peers.

### Concepts

#### PubSub

PubSub over Hyperswarm in this implementation is acheived using hyperswarm/rpc. We simply define a method for each topic we want to listen to, and when we want to broadcast an event to a topic, we call the method with the event as the payload.
The reason behind leveraging RPC and not simply performing swarm or dht topic lookups, and performing broadcasts by "iterating" over open connections of a given topic, and writing to it our specific event, is that the latter requires some "wire" codec to be implemented, some sort of "protocol" to be defined, and RPC already does all that for us (_for the purposes of this task, it's sufficient_)
If hyperswarm were to offer this functionality natively, I'd rely on dht.lookup and dht.announce (_as I think is already the case I think_) and add some "pubsub" wire protocol to have a binary structure for pubsub messages over connections (_broadcast, join and leave_) + multiplexing over a given dht topic's connections etc...

### Conclusion

In this design, we have outlined a simple implementation of a decentralized auction network using `hyperswarm` and `hyperbee`. The design consists of two main components: the `Peer` class and the `Network` class. The `Peer` class represents a peer in the network and has properties and methods to maintain the peerlist for topics, listen and broadcast events to topics, and sync the state of the network. The `Network` class represents the network of peers and has properties and methods to add and remove peers, broadcast events to topics, and sync the state of the network. We will test the implementation by creating a network of peers and having them open auctions, bid on auctions and close auctions, as well as testing the replication of the state of the network.

### Remaining to-do

1. Implement `openAuction` in the `App` class: this method will open an auction by creating an auction instance on the `hyperbee` instance of the peer and broadcasting an `auction_opened` event to the network.
2. Implement `bidOnAuction` in the `App` class: this method will bid on an auction by creating a bid instance in the database by creating or retrieving the key `bid:{auctionId}` (_we'll simply extend the existing records if the key already exists, we'll use an array to simplify things to represent the bid history_) and broadcasting a `bid` event to the network with the bid ID.
3. Implement `closeAuction` in the `App` class: this method will close an auction by fetching existing auction from `auctions` key in the database, marking it as a `closed` and then broadcasting an `auction_closed` event to the network.
4. Implement `auctions` topic handler: this topic handler will listen for `auction_opened` and `auction_closed` events and update the state of the network accordingly by creating a new auction in the (local) (own) database (in `auctions` key) or marking an existing auction as closed.
5. Implement `bids` topic handler: this topic handler will listen for `bid` events and update the state of the network accordingly by creating a new bid in the (local) (own) database in key `bid:{auctionId}` or extending the existing bid history.
6. Implement `height` rpc method: this method will return the height of the `hyperbee` instance of the peer.
7. Implement `sync` rpc method: this method will simply respond with the database's adveritised key (the public key of the database) to the peer that requested it for replication purposes.
8. Implement `syncState` in the `App` class: will be called on app.start, this method will sync the state of the network by requesting network state height from all peers participating in `auctions` and `bids` pubsub topics, then, it will request the highest network state's db key for replication (using `sync` rpc method). Upon receipt, it will create a new database instance to sync against the source peer's database to be snapshoted, and then batch written to own database before removing the source peer's database.
9. write a simple demo script whre:
   - 2 auctions are opened
   - 2 bids are placed
   - 2 auctions are closed
   - the winner is announced
