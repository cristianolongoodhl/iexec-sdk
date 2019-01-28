const Debug = require('debug');
const fs = require('fs-extra');
const path = require('path');
const {
  validateChainsConf,
  validateWalletConf,
  validateAccountConf,
  validateDeployedConf,
} = require('iexec-schema-validator');
const { prompt } = require('./cli-helper');
const templates = require('./templates');

const debug = Debug('iexec:fs');

const IEXEC_FILE_NAME = 'iexec.json';
const CHAIN_FILE_NAME = 'chain.json';
const ACCOUNT_FILE_NAME = 'account.json';
const WALLET_FILE_NAME = 'wallet.json';
const ENCRYPTED_WALLET_FILE_NAME = 'encrypted-wallet.json';
const DEPLOYED_FILE_NAME = 'deployed.json';
const ORDERS_FILE_NAME = 'orders.json';

const saveJSONToFile = async (
  fileName,
  obj,
  { force = false, strict = true, fileDir } = {},
) => {
  const json = JSON.stringify(obj, null, 2);
  try {
    let filePath;
    if (fileDir) {
      await fs.ensureDir(fileDir);
      filePath = path.join(fileDir, fileName);
    } else {
      filePath = fileName;
    }
    if (force) {
      await fs.writeFile(filePath, json);
      return filePath;
    }
    const fd = await fs.open(filePath, 'wx');
    await fs.write(fd, json, 0, 'utf8');
    await fs.close(fd);
    return filePath;
  } catch (error) {
    if (error.code === 'EEXIST') {
      const answer = await prompt.overwrite(fileName, { strict });
      if (answer) {
        let filePath;
        if (fileDir) {
          filePath = path.join(fileDir, fileName);
        } else {
          filePath = fileName;
        }
        await fs.writeFile(filePath, json);
        return filePath;
      }
      return '';
    }
    debug('saveJSONToFile()', error);
    throw error;
  }
};

const saveWallet = (obj, deflautFileName, options) => {
  const fileName = options.walletName || deflautFileName;
  return saveJSONToFile(fileName, obj, options);
};
const saveWalletConf = (obj, options) => saveWallet(obj, WALLET_FILE_NAME, options);
const saveEncryptedWalletConf = (obj, options) => saveWallet(obj, ENCRYPTED_WALLET_FILE_NAME, options);

const saveIExecConf = (obj, options) => saveJSONToFile(IEXEC_FILE_NAME, obj, options);
const saveAccountConf = (obj, options) => saveJSONToFile(ACCOUNT_FILE_NAME, obj, options);
const saveDeployedConf = (obj, options) => saveJSONToFile(DEPLOYED_FILE_NAME, obj, options);
const saveChainConf = (obj, options) => saveJSONToFile(CHAIN_FILE_NAME, obj, options);
const saveSignedOrders = (obj, options) => saveJSONToFile(ORDERS_FILE_NAME, obj, options);

const loadJSONFile = async (fileName, { fileDir } = {}) => {
  let filePath;
  if (fileDir) {
    filePath = path.join(fileDir, fileName);
  } else {
    filePath = path.join(process.cwd(), fileName);
  }
  debug('loading filePath', filePath);
  const fileJSON = await fs.readFile(filePath, 'utf8');
  const file = JSON.parse(fileJSON);
  return file;
};

const loadJSONAndRetry = async (fileName, options = {}) => {
  try {
    debug('options', options);
    const file = await loadJSONFile(fileName, options);

    if (options.validate) {
      options.validate(file);
      debug('valid', fileName);
    }
    return file;
  } catch (error) {
    debug('loadJSONAndRetry', error);

    if (error.code === 'ENOENT') {
      if (options.retry) return options.retry();
      throw new Error(
        `Missing "${fileName}" file, did you forget to run "iexec init"?`,
      );
    }
    throw new Error(`${error} in ${fileName}`);
  }
};
const loadIExecConf = options => loadJSONAndRetry(IEXEC_FILE_NAME, options);
const loadChainConf = options => loadJSONAndRetry(
  CHAIN_FILE_NAME,
  Object.assign(
    {
      validate: validateChainsConf,
    },
    options,
  ),
);
const loadAccountConf = options => loadJSONAndRetry(
  ACCOUNT_FILE_NAME,
  Object.assign(
    {
      validate: validateAccountConf,
    },
    options,
  ),
);
const loadWalletConf = options => loadJSONFile(
  options.fileName || WALLET_FILE_NAME,
  Object.assign(
    {
      validate: validateWalletConf,
    },
    options,
  ),
);
const loadEncryptedWalletConf = options => loadJSONFile(options.fileName || ENCRYPTED_WALLET_FILE_NAME, options);
const loadDeployedConf = options => loadJSONAndRetry(
  DEPLOYED_FILE_NAME,
  Object.assign(
    {
      validate: validateDeployedConf,
    },
    options,
  ),
);
const loadSignedOrders = options => loadJSONAndRetry(ORDERS_FILE_NAME, options);

const initIExecConf = async (options) => {
  const iexecConf = Object.assign(templates.main, { app: templates.app });
  const fileName = await saveIExecConf(iexecConf, options);
  return { saved: iexecConf, fileName };
};

const initChainConf = async (options) => {
  const fileName = await saveChainConf(templates.chains, options);
  return { saved: templates.chains, fileName };
};

const initObj = async (objName, { obj, overwrite = {} } = {}) => {
  try {
    const iexecConf = await loadIExecConf();
    iexecConf[objName] = obj || templates.overwriteObject(templates[objName], overwrite);
    const fileName = await saveIExecConf(iexecConf, { force: true });
    return { saved: iexecConf[objName], fileName };
  } catch (error) {
    debug('initObj()', error);
    throw error;
  }
};

const initOrderObj = async (orderName, overwrite) => {
  try {
    const iexecConf = await loadIExecConf();
    const order = templates.createOrder(orderName, overwrite);
    if (typeof iexecConf.order !== 'object') iexecConf.order = {};
    iexecConf.order[orderName] = order;
    const fileName = await saveIExecConf(iexecConf, { force: true });
    return { saved: order, fileName };
  } catch (error) {
    debug('initOrder()', error);
    throw error;
  }
};

const saveDeployedObj = async (objName, chainId, address) => {
  try {
    const deployedConf = await loadDeployedConf({ retry: () => ({}) });
    debug('deployedConf', deployedConf);

    if (typeof deployedConf[objName] !== 'object') deployedConf[objName] = {};
    deployedConf[objName][chainId] = address;

    await saveDeployedConf(deployedConf, { force: true });
  } catch (error) {
    debug('saveDeployedObj()', error);
    throw error;
  }
};

const saveSignedOrder = async (orderName, chainId, signedOrder) => {
  try {
    const signedOrders = await loadSignedOrders({ retry: () => ({}) });

    if (typeof signedOrders[chainId] !== 'object') signedOrders[chainId] = {};
    signedOrders[chainId][orderName] = signedOrder;

    const fileName = await saveSignedOrders(signedOrders, { force: true });
    return { saved: orderName, fileName };
  } catch (error) {
    debug('saveDeployedObj()', error);
    throw error;
  }
};

const loadDeployedObj = async (objName) => {
  const deployedConf = await loadDeployedConf({ retry: () => ({}) });

  if (typeof deployedConf[objName] !== 'object') return {};
  return deployedConf[objName];
};

module.exports = {
  saveJSONToFile,
  saveAccountConf,
  saveWalletConf,
  saveEncryptedWalletConf,
  saveDeployedConf,
  saveChainConf,
  saveSignedOrder,
  loadJSONFile,
  loadJSONAndRetry,
  loadIExecConf,
  loadChainConf,
  loadAccountConf,
  loadWalletConf,
  loadEncryptedWalletConf,
  loadDeployedConf,
  loadSignedOrders,
  saveDeployedObj,
  initObj,
  initIExecConf,
  loadDeployedObj,
  initChainConf,
  initOrderObj,
  IEXEC_FILE_NAME,
  CHAIN_FILE_NAME,
  ACCOUNT_FILE_NAME,
  WALLET_FILE_NAME,
  ENCRYPTED_WALLET_FILE_NAME,
  DEPLOYED_FILE_NAME,
  ORDERS_FILE_NAME,
};
