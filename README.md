# Hyperbid

Auctions over the hypercore protocol.

## Info

- Node Version: 20.10.0
- NPM Version: 10.2.3

## Usage

To start the demo script, run: (not implemented yet)

```js
npm start
```

For now, just run:

```
npm test
```

to see core functionality at play.

> **Note**: This is a work in progress. The system is not yet complete.
> The current implementation is a prototype and is not yet ready for production use.
> (Read the [design document](./DESIGN.md) for more details for the next lines to make sense)
>
> **Progress**:
> Right now, we have a fully functioning Peer abstraction with pubsub topics fully functioning and tested (_you can run the tests_)
> Also, the database abstraction is fully functional and tested (_you can run the tests_)
>
> What is remaining is the implementation auction actions: openAuction, closeAuctions, bidOnAuction.
> Detailed instructions on how we would continue to implement these actions are in the [design document](./DESIGN.md)
>
> Thank you

## Scripts

- `npm test` - Run tests
- `npm start` - Start the server
- `npm run bootstrap:start` - Start the bootstrap server

## Documentation

Read about the design details in the [design document](./DESIGN.md) where we discuss the architecture
and how we built the system. Also mentions the assumptions, limitations and what's still left to implement to achieve
a complete version.
