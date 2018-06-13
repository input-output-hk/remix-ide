[![Build Status](https://travis-ci.org/ethereum/remix-ide.svg?branch=master)](https://travis-ci.org/ethereum/remix-ide)
[![BrowserStack Status](https://www.browserstack.com/automate/badge.svg?badge_key=MTc5WVBoNnhOTGhaUng3ZFI3MDZvNWkraHIrd1FNanZIZk80SG9uMkFIND0tLUoyUjd1YVhWRnRrcUJMMnFlbmN3Y0E9PQ==--4085377897aef217e507c8fc46d463eb699838b8)](https://www.browserstack.com/automate/public-build/MTc5WVBoNnhOTGhaUng3ZFI3MDZvNWkraHIrd1FNanZIZk80SG9uMkFIND0tLUoyUjd1YVhWRnRrcUJMMnFlbmN3Y0E9PQ==--4085377897aef217e507c8fc46d463eb699838b8)


# Remix

Remix is a browser-based compiler and IDE that enables users to build **Ethereum contracts with Solidity language** and to debug transactions.

To try it out, visit [https://remix.ethereum.org](https://remix.ethereum.org).

Remix consists of many modules and in this repository you will find the Remix IDE (aka. Browser-Solidity).

![Remix screenshot](https://i.imgur.com/clfc7US.png)

## INSTALLATION (by RV):

> Difference: We include `remix` repository directly in this repository.

Install **npm** and **node.js** (see https://docs.npmjs.com/getting-started/installing-node), then do:

```bash
git clone https://github.com/ethereum/remix-ide.git
cd remix-ide
npm install
npm run linkremixcore && npm run linkremixlib && npm run linkremixsolidity
npm start
```

## DEVELOPING:

Run `npm start` and open `http://127.0.0.1:8080` in your browser.

Then open your `text editor` and start developing.
The browser will automatically refresh when files are saved.

Most of the the time working with other modules (like debugger etc.) hosted in the [Remix repository](https://github.com/ethereum/remix) is not needed.

## DEPLOYMENT (by RV):

Run `npm run build` which will build `./build/app.js` file.   
Then copy the whole repository to server.

### Troubleshooting building

Some things to consider if you have trouble building the package:

- Make sure that you have the correct version of `node`, `npm` and `nvm`. You can find the version that is tested on Travis CI by looking at the log in the [build results](https://travis-ci.org/ethereum/remix-ide).

Run:

```bash
node --version
npm --version
nvm --version
```

- In Debian based OS such as Ubuntu 14.04LTS you may need to run `apt-get install build-essential`. After installing `build-essential` run `npm rebuild`.

## Unit Testing

Register new unit test files in `test/index.js`.
The tests are written using [tape](https://www.npmjs.com/package/tape).

Run the unit tests via: `npm test`

For local headless browser tests run `npm run test-browser`
(requires Selenium to be installed - can be done with `npm run selenium-install`)

Running unit tests via `npm test` requires at least node v7.0.0

## Browser Testing

To run the Selenium tests via Nightwatch serve the app through a local web server:

`npm run serve` # starts web server at localhost:8080

Then you will need to either:

1. Have a Selenium server running locally on port 4444.
	- Run: `npm run test-browser`

2. Or, install and run SauceConnect.
	- Run: `sc -u <USERNAME> -k <ACCESS_KEY>` (see `.travis.yml` for values)
	- Run: `npm run browser-test-sc`

## Usage as a Chrome Extension

If you would like to use this as a Chrome extension, you must either build it first or pull from the `gh-pages` branch, both described above.
After that, follow these steps:

- Browse to `chrome://extensions/`
- Make sure 'Developer mode' has been checked
- Click 'Load unpacked extension...' to pop up a file-selection dialog
- Select your `remix-ide` folder

## Documentation

To see details about how to use Remix for developing and/or debugging Solidity contracts, please see [our documentation page](https://remix.readthedocs.io)


## References
* [Web3 sendRawTransaction](https://ethereum.stackexchange.com/questions/36358/how-to-properly-create-a-raw-transaction-and-sign-it-using-web3-in-browser?rq=1&utm_medium=organic&utm_source=google_rich_qa&utm_campaign=google_rich_qa)