# Music Trader

Music Trader is a gamified music prediction market developed by Team OneShot for CEN3031: Introduction to Software Engineering at the University of Florida.

Users trade UP and DOWN contracts using virtual currency called Music Notes based on how they predict songs will move on weekly Billboard charts. The application allows users to apply their music knowledge, learn the basics of prediction markets, track their performance, and compete with friends without risking real money.

## Team Members

- Luis Andre Blanco — Project Manager, Scrum Master, and Developer
- Jovon Alexis — Developer
- Jack Harris — Developer
- Michael Kroner — Developer

## Planned Features

- User registration, login, logout, and profiles
- Trader and administrator user roles
- Weekly song markets based on Billboard chart movement
- UP and DOWN song contracts
- Virtual Music Note balances
- Buying and selling positions before market resolution
- Automated trading bots and fallback market-making
- Active and past position tracking
- Realized profit-and-loss and win-loss records
- Weekly, monthly, all-time, and friends-only leaderboards
- Weekly champions
- Billboard chart-data ingestion
- Song information and artwork

## Technology Stack

### Programming Languages

- Go for backend services and the trading system
- Python for Billboard data ingestion, initial market pricing, and potential reinforcement-learning bots
- TypeScript for frontend development

### Frameworks and Libraries

- Next.js and React for the web application
- TradingView Lightweight Charts and Visx or Recharts for data visualization
- TanStack Query for asynchronous data fetching and caching
- TanStack Table for data tables
- Tailwind CSS and shadcn/ui for interface design

### Data and Infrastructure

- PostgreSQL for users, songs, chart data, markets, trades, positions, orders, Music Note balances, and leaderboards
- Redis for caching, live market data, and session storage if needed
- TigerBeetle for an immutable transaction ledger if needed
- Billboard charts as the market-resolution source
- Spotify or Apple Music APIs for song metadata and artwork if needed

## Development Tools

- Git and GitHub for version control and configuration management
- Protected feature-branch and pull-request workflow
- GitHub Issues and GitHub Projects for project management

## Project Status

Planning and development-environment setup.
