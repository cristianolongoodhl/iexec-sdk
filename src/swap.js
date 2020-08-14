const Debug = require('debug');
const BN = require('bn.js');
const { Interface } = require('ethers').utils;
const walletModule = require('./wallet');
const accountModule = require('./account');
const swapInterfaceDesc = require('./abi/uniswapv2/EventInterface.json');
const { ethersBnToBn, bnToEthersBn, NULL_ADDRESS } = require('./utils');
const {
  weiAmountSchema,
  nRlcAmountSchema,
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
    debug('estimateDepositRlcToReceive()', error);
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
    debug('estimateDepositEthToSpend()', error);
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
    debug('estimateWithdrawRlcToSpend()', error);
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
    debug('estimateWithdrawEthToReceive()', error);
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
    debug('depositEth()', error);
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
    debug('withdrawEth()', error);
    throw error;
  }
};

module.exports = {
  checkSwapEnabled,
  estimateDepositRlcToReceive,
  estimateDepositEthToSpend,
  estimateWithdrawRlcToSpend,
  estimateWithdrawEthToReceive,
  depositEth,
  withdrawEth,
};
