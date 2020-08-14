const Debug = require('debug');
const BN = require('bn.js');
const { Interface } = require('ethers').utils;
const walletModule = require('./wallet');
const accountModule = require('./account');
const orderModule = require('./order');
const hubModule = require('./hub');
const swapInterfaceDesc = require('./abi/uniswapv2/EventInterface.json');
const {
  checkEvent,
  getEventFromLogs,
  ethersBnToBn,
  bnToEthersBn,
  NULL_ADDRESS,
} = require('./utils');
const {
  weiAmountSchema,
  nRlcAmountSchema,
  signedApporderSchema,
  signedDatasetorderSchema,
  signedWorkerpoolorderSchema,
  signedRequestorderSchema,
  positiveStrictIntSchema,
  throwIfMissing,
} = require('./validator');
const { wrapCall, wrapSend, wrapWait } = require('./errorWrappers');

const debug = Debug('iexec:swap');

const checkSwapEnabled = async (
  contracts = throwIfMissing(),
  strict = true,
) => {
  if (contracts.isNative) {
    if (strict) {
      throw new Error('Ether/RLC swap is not enabled on current chain');
    }
    return false;
  }
  debug('checkSwapEnabled() TODO');
  return true;
};

const estimateDepositRlcToReceive = async (
  contracts = throwIfMissing(),
  weiToSpend = throwIfMissing(),
) => {
  try {
    await checkSwapEnabled(contracts);
    const vAmount = await weiAmountSchema().validate(weiToSpend);
    if (new BN(vAmount).lte(new BN(0))) throw Error('amount must be greather than 0');
    const iexecContract = contracts.getIExecContract();
    const nRlcToReceive = await wrapCall(
      iexecContract.estimateDepositEthSent(vAmount),
    );
    return ethersBnToBn(nRlcToReceive);
  } catch (error) {
    debug('estimateDepositRlcToReceive() error', error);
    throw error;
  }
};

const estimateDepositEthToSpend = async (
  contracts = throwIfMissing(),
  nRlcToReceive = throwIfMissing(),
) => {
  try {
    await checkSwapEnabled(contracts);
    const vAmount = await nRlcAmountSchema().validate(nRlcToReceive);
    if (new BN(vAmount).lte(new BN(0))) throw Error('amount must be greather than 0');
    const iexecContract = contracts.getIExecContract();
    const weiToSpend = await wrapCall(
      iexecContract.estimateDepositTokenWanted(vAmount),
    );
    return ethersBnToBn(weiToSpend);
  } catch (error) {
    debug('estimateDepositEthToSpend() error', error);
    throw error;
  }
};

const estimateWithdrawRlcToSpend = async (
  contracts = throwIfMissing(),
  weiToReceive = throwIfMissing(),
) => {
  try {
    await checkSwapEnabled(contracts);
    const vAmount = await weiAmountSchema().validate(weiToReceive);
    if (new BN(vAmount).lte(new BN(0))) throw Error('amount must be greather than 0');
    const iexecContract = contracts.getIExecContract();
    const nRlcToSpend = await wrapCall(
      iexecContract.estimateWithdrawEthWanted(vAmount),
    );
    return ethersBnToBn(nRlcToSpend);
  } catch (error) {
    debug('estimateWithdrawRlcToSpend() error', error);
    throw error;
  }
};

const estimateWithdrawEthToReceive = async (
  contracts = throwIfMissing(),
  nRlcToSpend = throwIfMissing(),
) => {
  try {
    await checkSwapEnabled(contracts);
    const vAmount = await nRlcAmountSchema().validate(nRlcToSpend);
    if (new BN(vAmount).lte(new BN(0))) throw Error('amount must be greather than 0');
    const iexecContract = contracts.getIExecContract();
    const weiToReceive = await wrapCall(
      iexecContract.estimateWithdrawTokenSent(vAmount),
    );
    return ethersBnToBn(weiToReceive);
  } catch (error) {
    debug('estimateWithdrawEthToReceive() error', error);
    throw error;
  }
};

const depositEth = async (
  contracts = throwIfMissing(),
  weiToSpend = throwIfMissing(),
  nRlcToReceive = throwIfMissing(),
) => {
  try {
    await checkSwapEnabled(contracts);
    const vToSpend = await weiAmountSchema().validate(weiToSpend);
    const vToReceive = await nRlcAmountSchema().validate(nRlcToReceive);
    const userAddress = await walletModule.getAddress(contracts);
    const balances = await walletModule.checkBalances(contracts, userAddress);
    const toSpendBN = new BN(vToSpend);
    if (balances.wei.lt(toSpendBN)) throw Error('Deposit amount exceed wallet balance');
    const iexecContract = contracts.getIExecContract();
    const iexecContractAddress = await iexecContract.resolvedAddress;
    const tx = await wrapSend(
      iexecContract.safeDepositEth(vToReceive, {
        value: bnToEthersBn(toSpendBN).toHexString(),
        gasPrice:
          (contracts.txOptions && contracts.txOptions.gasPrice) || undefined,
      }),
    );
    const txReceipt = await wrapWait(tx.wait());
    const mintEvent = txReceipt.events
      && txReceipt.events.find((event) => {
        if (event.event === 'Transfer') {
          if (
            event.address === iexecContractAddress
            && event.args
            && event.args.from === NULL_ADDRESS
            && event.args.to === userAddress
          ) {
            return true;
          }
        }
        return false;
      });
    if (!mintEvent) {
      throw Error(`Deposit ether transaction failed (txHash: ${tx.hash})`);
    }
    const received = ethersBnToBn(mintEvent.args.value);
    return {
      txHash: tx.hash,
      spentAmount: toSpendBN,
      receivedAmount: received,
    };
  } catch (error) {
    debug('depositEth() error', error);
    throw error;
  }
};

const withdrawEth = async (
  contracts = throwIfMissing(),
  nRlcToSpend = throwIfMissing(),
  weiToReceive = throwIfMissing(),
) => {
  try {
    await checkSwapEnabled(contracts);
    const vToSpend = await nRlcAmountSchema().validate(nRlcToSpend);
    const vToReceive = await weiAmountSchema().validate(weiToReceive);
    const userAddress = await walletModule.getAddress(contracts);
    const { stake } = await accountModule.checkBalance(contracts, userAddress);
    const toSpendBN = new BN(vToSpend);
    if (stake.lt(toSpendBN)) throw Error('Withdraw amount exceed account balance');
    const iexecContract = contracts.getIExecContract();
    const iexecContractAddress = await iexecContract.resolvedAddress;
    const tx = await wrapSend(
      iexecContract.safeWithdrawEth(vToSpend, vToReceive, contracts.txOptions),
    );
    const rlcContractAddress = await contracts.fetchRLCAddress();
    const txReceipt = await wrapWait(tx.wait());
    const transferRlcToSwapContractEvent = txReceipt.events
      && txReceipt.events.find((event) => {
        if (event.event === 'Transfer') {
          if (
            event.address === rlcContractAddress
            && event.args
            && event.args.from === iexecContractAddress
            && event.args.to
          ) {
            return true;
          }
        }
        return false;
      });
    const swapContractAddress = transferRlcToSwapContractEvent.args.to;
    const swapInterface = new Interface(swapInterfaceDesc.abi);
    const swapEventValues = txReceipt.events
      .filter(event => event.address === swapContractAddress)
      .reduce((acc, event) => {
        try {
          const {
            sender,
            to,
            amount0In,
            amount1In,
            amount0Out,
            amount1Out,
          } = swapInterface.decodeEventLog('Swap', event.data);
          return {
            sender,
            to,
            amount0In,
            amount1In,
            amount0Out,
            amount1Out,
          };
        } catch (e) {
          return acc;
        }
      }, null);
    if (!swapEventValues || !swapEventValues.amount0Out) {
      throw Error(`Withdraw ether transaction failed (txHash: ${tx.hash})`);
    }
    const received = ethersBnToBn(swapEventValues.amount0Out);
    return {
      txHash: tx.hash,
      spentAmount: toSpendBN,
      receivedAmount: received,
    };
  } catch (error) {
    debug('withdrawEth() error', error);
    throw error;
  }
};

const estimateMatchOrderEthToSpend = async (
  contracts = throwIfMissing(),
  apporder = throwIfMissing(),
  datasetorder = orderModule.NULL_DATASETORDER,
  workerpoolorder = throwIfMissing(),
  requestorder = throwIfMissing(),
) => {
  try {
    await checkSwapEnabled(contracts);
    const [
      vApporder,
      vDatasetorder,
      vWorkerpoolorder,
      vRequestorder,
    ] = await Promise.all([
      signedApporderSchema().validate(apporder),
      signedDatasetorderSchema().validate(datasetorder),
      signedWorkerpoolorderSchema().validate(workerpoolorder),
      signedRequestorderSchema().validate(requestorder),
    ]);
    const volume = await orderModule.getMatchableVolume(
      contracts,
      vApporder,
      vDatasetorder,
      vWorkerpoolorder,
      vRequestorder,
    );
    const nRlcPrice = volume.mul(
      new BN(apporder.appprice)
        .add(new BN(datasetorder.datasetprice))
        .add(new BN(workerpoolorder.workerpoolprice)),
    );
    const weiToSpend = nRlcPrice.isZero()
      ? nRlcPrice
      : await estimateDepositEthToSpend(contracts, nRlcPrice);
    return { weiToSpend, volume, nRlcPrice };
  } catch (error) {
    debug('estimateMatchOrderEthToSpend() error', error);
    throw error;
  }
};

const matchOrdersWithEth = async (
  contracts = throwIfMissing(),
  appOrder = throwIfMissing(),
  datasetOrder = orderModule.NULL_DATASETORDER,
  workerpoolOrder = throwIfMissing(),
  requestOrder = throwIfMissing(),
  weiToSpend = throwIfMissing(),
  minVolumeToExecute = 1,
) => {
  try {
    await checkSwapEnabled(contracts);
    const vToSpend = await weiAmountSchema().validate(weiToSpend);
    const vVolume = await positiveStrictIntSchema().validate(
      minVolumeToExecute,
    );
    const [
      vAppOrder,
      vDatasetOrder,
      vWorkerpoolOrder,
      vRequestOrder,
    ] = await Promise.all([
      signedApporderSchema().validate(appOrder),
      signedDatasetorderSchema().validate(datasetOrder),
      signedWorkerpoolorderSchema().validate(workerpoolOrder),
      signedRequestorderSchema().validate(requestOrder),
    ]);

    const volumeToExecuteBN = new BN(vVolume);

    // check matchability
    const matchableVolume = await orderModule.getMatchableVolume(
      contracts,
      vAppOrder,
      vDatasetOrder,
      vWorkerpoolOrder,
      vRequestOrder,
    );

    if (matchableVolume.lt(volumeToExecuteBN)) {
      throw Error("Can't execute requested volume");
    }

    // workerpool owner stake check
    const workerpoolPrice = new BN(vWorkerpoolOrder.workerpoolprice);
    const workerpoolOwner = await hubModule.getWorkerpoolOwner(
      contracts,
      vWorkerpoolOrder.workerpool,
    );
    const { stake } = await accountModule.checkBalance(
      contracts,
      workerpoolOwner,
    );
    const requiredStake = volumeToExecuteBN.mul(
      workerpoolPrice.mul(new BN(30)).div(new BN(100)),
    );
    if (stake.lt(requiredStake)) {
      throw Error(
        `workerpool required stake (${requiredStake}) is greather than workerpool owner's account stake (${stake}). Can't execute requested volume.`,
      );
    }

    const appOrderStruct = orderModule.signedOrderToStruct(
      orderModule.APP_ORDER,
      vAppOrder,
    );
    const datasetOrderStruct = orderModule.signedOrderToStruct(
      orderModule.DATASET_ORDER,
      vDatasetOrder,
    );
    const workerpoolOrderStruct = orderModule.signedOrderToStruct(
      orderModule.WORKERPOOL_ORDER,
      vWorkerpoolOrder,
    );
    const requestOrderStruct = orderModule.signedOrderToStruct(
      orderModule.REQUEST_ORDER,
      vRequestOrder,
    );
    const iexecContract = contracts.getIExecContract();
    const tx = await wrapSend(
      iexecContract.matchOrdersWithEth(
        appOrderStruct,
        datasetOrderStruct,
        workerpoolOrderStruct,
        requestOrderStruct,
        {
          value: bnToEthersBn(new BN(vToSpend)).toHexString(),
          gasPrice:
            (contracts.txOptions && contracts.txOptions.gasPrice) || undefined,
        },
      ),
    );
    const txReceipt = await wrapWait(tx.wait());
    const matchEvent = 'OrdersMatched';
    if (!checkEvent(matchEvent, txReceipt.events)) throw Error(`${matchEvent} not confirmed`);
    const { dealid, volume } = getEventFromLogs(
      matchEvent,
      txReceipt.events,
    ).args;
    return { dealid, volume: ethersBnToBn(volume), txHash: tx.hash };
  } catch (error) {
    debug('matchOrdersWithEth() error', error);
    throw error;
  }
};

module.exports = {
  checkSwapEnabled,
  estimateDepositRlcToReceive,
  estimateDepositEthToSpend,
  estimateWithdrawRlcToSpend,
  estimateWithdrawEthToReceive,
  estimateMatchOrderEthToSpend,
  depositEth,
  withdrawEth,
  matchOrdersWithEth,
};
