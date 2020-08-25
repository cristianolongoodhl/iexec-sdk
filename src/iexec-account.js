#!/usr/bin/env node

const cli = require('commander');
const account = require('./account');
const swap = require('./swap');
const { Keystore } = require('./keystore');
const { loadChain, connectKeystore } = require('./chains');
const {
  stringifyNestedBn,
  isRlcUnit,
  isEthUnit,
  formatRLC,
  formatEth,
  NULL_ADDRESS,
} = require('./utils');
const {
  help,
  addGlobalOptions,
  addWalletLoadOptions,
  computeWalletLoadOptions,
  computeTxOptions,
  checkUpdate,
  handleError,
  option,
  desc,
  Spinner,
  info,
  prompt,
  pretty,
} = require('./cli-helper');
const { weiAmountSchema, nRlcAmountSchema } = require('./validator');

const objName = 'account';

cli.name('iexec account').usage('<command> [options]');

const deposit = cli.command('deposit <amount> [unit]');
addGlobalOptions(deposit);
addWalletLoadOptions(deposit);
deposit
  .option(...option.chain())
  .option(...option.txGasPrice())
  .description(desc.deposit())
  .action(async (amount, unit, cmd) => {
    await checkUpdate(cmd);
    const spinner = Spinner(cmd);
    try {
      const walletOptions = await computeWalletLoadOptions(cmd);
      const txOptions = await computeTxOptions(cmd);
      const keystore = Keystore(walletOptions);
      const chain = await loadChain(cmd.chain, {
        spinner,
      });
      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.depositing());
      const depositRes = await account.deposit(chain.contracts, [amount, unit]);
      spinner.succeed(info.deposited(formatRLC(depositRes.amount)), {
        raw: { amount: depositRes.amount, txHash: depositRes.txHash },
      });
    } catch (error) {
      handleError(error, cli, cmd);
    }
  });

const withdraw = cli.command('withdraw <amount> [unit]');
addGlobalOptions(withdraw);
addWalletLoadOptions(withdraw);
withdraw
  .option(...option.chain())
  .option(...option.txGasPrice())
  .description(desc.withdraw())
  .action(async (amount, unit, cmd) => {
    await checkUpdate(cmd);
    const spinner = Spinner(cmd);
    try {
      const walletOptions = await computeWalletLoadOptions(cmd);
      const txOptions = await computeTxOptions(cmd);
      const keystore = Keystore(walletOptions);
      const chain = await loadChain(cmd.chain, {
        spinner,
      });
      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.withdrawing());
      const res = await account.withdraw(chain.contracts, [amount, unit]);
      spinner.succeed(info.withdrawn(formatRLC(res.amount)), {
        raw: { amount: res.amount, txHash: res.txHash },
      });
    } catch (error) {
      handleError(error, cli, cmd);
    }
  });

const depositEth = cli.command('deposit-eth <amount> [unit]');
addGlobalOptions(depositEth);
addWalletLoadOptions(depositEth);
depositEth
  .option(...option.chain())
  .option(...option.txGasPrice())
  .description(desc.depositEth())
  .action(async (amount, unit = 'wei', cmd) => {
    await checkUpdate(cmd);
    const spinner = Spinner(cmd);
    try {
      const walletOptions = await computeWalletLoadOptions(cmd);
      const txOptions = await computeTxOptions(cmd);
      const keystore = Keystore(walletOptions);
      const chain = await loadChain(cmd.chain, {
        spinner,
      });
      let weiToSpend;
      let nRlcToReceive;
      if (isEthUnit(unit)) {
        weiToSpend = await weiAmountSchema().validate([amount, unit]);
        spinner.start(info.checkingSwapRate());
        nRlcToReceive = await swap.estimateDepositRlcToReceive(
          chain.contracts,
          weiToSpend,
        );
        if (nRlcToReceive.isZero()) {
          throw Error(
            `Specified amount (${formatEth(
              weiToSpend,
            )} ether) is lower than minimum amount. Try to increase the ether amount to deposit or specify the RLC wanted amount with "iexec deposit-eth <amount> RLC"`,
          );
        }
      } else if (isRlcUnit(unit)) {
        nRlcToReceive = await nRlcAmountSchema().validate([amount, unit]);
        spinner.start(info.checkingSwapRate());
        weiToSpend = await swap.estimateDepositEthToSpend(
          chain.contracts,
          nRlcToReceive,
        );
      } else {
        throw new Error('Invalid unit, must be RLC unit or ether unit');
      }
      spinner.stop();
      await prompt.depositEthToRlc(
        formatEth(weiToSpend),
        formatRLC(nRlcToReceive),
      );
      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.depositing());
      const { txHash, spentAmount, receivedAmount } = await swap.depositEth(
        chain.contracts,
        weiToSpend,
        nRlcToReceive,
      );
      spinner.succeed(
        info.depositedEth(formatEth(spentAmount), formatRLC(receivedAmount)),
        {
          raw: {
            txHash,
            spentAmount: spentAmount.toString(),
            receivedAmount: receivedAmount.toString(),
          },
        },
      );
    } catch (error) {
      handleError(error, cli, cmd);
    }
  });

const withdrawEth = cli.command('withdraw-eth <amount> [unit]');
addGlobalOptions(withdrawEth);
addWalletLoadOptions(withdrawEth);
withdrawEth
  .option(...option.chain())
  .option(...option.txGasPrice())
  .description(desc.withdrawEth())
  .action(async (amount, unit = 'nRLC', cmd) => {
    await checkUpdate(cmd);
    const spinner = Spinner(cmd);
    try {
      const walletOptions = await computeWalletLoadOptions(cmd);
      const txOptions = await computeTxOptions(cmd);
      const keystore = Keystore(walletOptions);
      const chain = await loadChain(cmd.chain, {
        spinner,
      });
      let nRlcToSpend;
      let weiToReceive;
      if (isRlcUnit(unit)) {
        nRlcToSpend = await nRlcAmountSchema().validate([amount, unit]);
        spinner.start(info.checkingSwapRate());
        weiToReceive = await swap.estimateWithdrawEthToReceive(
          chain.contracts,
          nRlcToSpend,
        );
        if (weiToReceive.isZero()) {
          throw Error(
            `Specified amount (${formatRLC(
              nRlcToSpend,
            )} RLC) is lower than minimum amount. Try to increase the RLC amount to withdraw or specify the ether wanted amount with "iexec withdraw-eth <amount> ether"`,
          );
        }
      } else if (isEthUnit(unit)) {
        weiToReceive = await weiAmountSchema().validate([amount, unit]);
        spinner.start(info.checkingSwapRate());
        nRlcToSpend = await swap.estimateWithdrawRlcToSpend(
          chain.contracts,
          weiToReceive,
        );
      } else {
        throw new Error('Invalid unit, must be RLC unit or ether unit');
      }
      spinner.stop();
      await prompt.withdrawRlcToEth(
        formatRLC(nRlcToSpend),
        formatEth(weiToReceive),
      );
      await connectKeystore(chain, keystore, { txOptions });
      spinner.start(info.withdrawing());
      const { txHash, spentAmount, receivedAmount } = await swap.withdrawEth(
        chain.contracts,
        nRlcToSpend,
        weiToReceive,
      );
      spinner.succeed(
        info.withdrawnEth(formatRLC(spentAmount), formatEth(receivedAmount)),
        {
          raw: {
            txHash,
            spentAmount: spentAmount.toString(),
            receivedAmount: receivedAmount.toString(),
          },
        },
      );
    } catch (error) {
      handleError(error, cli, cmd);
    }
  });

const show = cli.command('show [address]');
addGlobalOptions(show);
addWalletLoadOptions(show);
show
  .option(...option.chain())
  .description(desc.showObj('iExec', objName))
  .action(async (address, cmd) => {
    await checkUpdate(cmd);
    const spinner = Spinner(cmd);
    try {
      const walletOptions = await computeWalletLoadOptions(cmd);
      const keystore = Keystore(
        Object.assign({}, walletOptions, { isSigner: false }),
      );

      let userAddress;
      if (!address) {
        try {
          const [userWalletAddress] = await keystore.accounts();
          if (userWalletAddress && userWalletAddress !== NULL_ADDRESS) {
            userAddress = userWalletAddress;
            spinner.info(`Current account address ${userWalletAddress}`);
          } else {
            throw Error('Wallet file not found');
          }
        } catch (error) {
          throw Error(
            `Failed to load wallet address from keystore: ${error.message}`,
          );
        }
      } else {
        userAddress = address;
      }
      if (!userAddress) throw Error('Missing address or wallet');

      const chain = await loadChain(cmd.chain, { spinner });

      spinner.start(info.checkBalance('iExec account'));
      const balances = await account.checkBalance(chain.contracts, userAddress);
      const cleanBalance = stringifyNestedBn(balances);
      spinner.succeed(
        `Account balances (RLC):${pretty({
          stake: formatRLC(cleanBalance.stake),
          locked: formatRLC(cleanBalance.locked),
        })}`,
        {
          raw: { balance: cleanBalance },
        },
      );
    } catch (error) {
      handleError(error, cli, cmd);
    }
  });

help(cli);
