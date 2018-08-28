# Remix-IELE
Browser-based IDE enables users to build **smart contracts with Solidity running on the IELE Virtual Machine**.
forked by [Runtime Verification](https://runtimeverification.com/) and [IOHK](https://iohk.io/) (based on the original Remix project by the Ethereum Foundation).

**IELE** is a dedicated virtual machine that provides a foundation for the Cardano blockchain protocol. It executes and verifies smart contracts as well as providing a human-readable language for blockchain developers. IELE was designed using formal methods to address security and correctness concerns inherent in writing Solidity smart contracts


To try it out, visit [https://testnet.iohkdev.io/iele/compiler/](https://testnet.iohkdev.io/iele/compiler/).

Remix consists of many modules and in this repository you will find the Remix IDE (aka. Browser-Solidity).

![Remix screenshot](https://testnet.iohkdev.io/images/remix-iele.png)

## INSTALLATION (by RV):
You don't really need to install it, you can use the browser version. But if you need a local copy you can install it with following steps:

Install **npm** and **node.js** (Recommended to use `LTS` version) (see https://docs.npmjs.com/getting-started/installing-node), then do:

```
git clone https://github.com/input-output-hk/remix-ide.git
cd remix-ide
npm install
npm run linkremixcore
npm run linkremixlib
npm run linkremixsolidity
npm start
```

## DEVELOPING:

Run `npm start` and open `http://127.0.0.1:8080` in your browser.

Then open your `text editor` and start developing.
The browser will automatically refresh when files are saved.

Most of the the time working with other modules (like debugger etc.) hosted in the [Remix repository](https://github.com/input-output-hk/remix-ide) is not needed.

## DEPLOYMENT (by RV):

Run `npm run build` which will build `./build/app.js` file.   
Then copy the whole repository to server.

### Troubleshooting building

Some things to consider if you have trouble building the package:



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

To see details about how to use Remix for developing and/or debugging Solidity contracts, please see [our documentation page](https://webdevc.iohk.io/iele/get-started/executing-solidity-contracts/)


## References
* [IELE Testnet - No DAO Attack with IELE
](https://www.youtube.com/watch?v=jz5gu4keU9U)

## Acknowledgments

We would like to thank to the original Remix project. You can find them in [https://github.com/ethereum/remix-ide](https://github.com/ethereum/remix-ide)

