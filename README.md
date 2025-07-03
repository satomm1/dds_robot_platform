# DDS Robot Platform

## Overview
This repo contains the software for a human observer to connect to the mobile robot platform. Included in this repo is:
- `./dds`: The software for connecting to the other agents (i.e., mobile robots) via DDS
- `./gui`: The software for the web-based GUI for human interaction
- `./graphql`: The GraphQL implementation for API calls
- `./ignite`: Contains log files for the ignite database

## Getting Started
To run DDS, you need [Docker Desktop](https://www.docker.com/products/docker-desktop/). Please follow the instructions to download and install Docker.

You will also need a conda environment. I recommend miniconda. 

## DDS


## GUI

1) Install Node.js from https://nodejs.org/en

    Verify installation by opening the commmand line and running:
    ```
    node -v
    npm -v
    ```

2) Navigate to the `gui` directory and install dependencies:
    ```
    cd gui
    ```
    ```
    npm install
    ```

3) Start the server:
    ```
    npm start
    ```

    Alternatively, to run a production build:
    ```
    npm run build
    npm install -g serve
    serve -s build
    ```
