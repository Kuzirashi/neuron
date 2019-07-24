import { useEffect } from 'react'

import { WalletWizardPath } from 'components/WalletWizard'
import { NeuronWalletActions, StateDispatch, AppActions } from 'states/stateProvider/reducer'
import { actionCreators } from 'states/stateProvider/actionCreators'

import UILayer, {
  AppMethod,
  ChainMethod,
  NetworksMethod,
  TransactionsMethod,
  WalletsMethod,
  walletsCall,
  transactionsCall,
  networksCall,
} from 'services/UILayer'
import { initWindow } from 'services/remote'
import {
  SystemScript as SystemScriptSubject,
  DataUpdate as DataUpdateSubject,
  NetworkList as NetworkListSubject,
} from 'services/subjects'
import { ckbCore, getTipBlockNumber, getBlockchainInfo } from 'services/chain'
import { Routes, Channel, ConnectionStatus } from 'utils/const'
import {
  wallets as walletsCache,
  networks as networksCache,
  addresses as addressesCache,
  currentNetworkID as currentNetworkIDCache,
  currentWallet as currentWalletCache,
  systemScript as systemScriptCache,
} from 'utils/localCache'
import addressesToBalance from 'utils/addressesToBalance'
import initializeApp from 'utils/initializeApp'

let timer: NodeJS.Timeout
const SYNC_INTERVAL_TIME = 10000

export const useChannelListeners = ({
  walletID,
  chain,
  dispatch,
  history,
  i18n,
}: {
  walletID: string
  chain: State.Chain
  dispatch: StateDispatch
  history: any
  i18n: any
}) =>
  useEffect(() => {
    UILayer.on(Channel.App, (_e: Event, method: AppMethod, args: ChannelResponse<any>) => {
      if (args && args.status) {
        switch (method) {
          case AppMethod.NavTo: {
            history.push(args.result)
            break
          }
          case AppMethod.ToggleAddressBook: {
            dispatch(actionCreators.toggleAddressBook())
            break
          }
          default: {
            break
          }
        }
      }
    })

    UILayer.on(Channel.Chain, (_e: Event, method: ChainMethod, args: ChannelResponse<any>) => {
      if (args && args.status) {
        switch (method) {
          case ChainMethod.Status: {
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: {
                connectionStatus: args.result ? ConnectionStatus.Online : ConnectionStatus.Offline,
              },
            })
            break
          }
          case ChainMethod.TipBlockNumber: {
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: {
                tipBlockNumber: args.result || '0',
              },
            })
            break
          }
          default: {
            break
          }
        }
      }
    })

    UILayer.on(Channel.Transactions, (_e: Event, method: TransactionsMethod, args: ChannelResponse<any>) => {
      if (args.status) {
        switch (method) {
          case TransactionsMethod.GetAllByKeywords: {
            // TODO: verify the wallet id the transactions belong to
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: { transactions: { ...chain.transactions, ...args.result } },
            })
            break
          }
          case TransactionsMethod.Get: {
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: { transaction: args.result },
            })
            break
          }
          case TransactionsMethod.TransactionUpdated: {
            const updatedTransaction: State.Transaction = args.result
            if (
              (!chain.transactions.items.length ||
                updatedTransaction.timestamp === null ||
                +(updatedTransaction.timestamp || updatedTransaction.createdAt) >
                  +(chain.transactions.items[0].timestamp || chain.transactions.items[0].createdAt)) &&
              chain.transactions.pageNo === 1
            ) {
              /**
               * 1. transaction list is empty or the coming transaction is pending or the coming transaction is later than latest transaction in current list
               * 2. the current page number is 1
               */
              const newTransactionItems = [updatedTransaction, ...chain.transactions.items].slice(
                0,
                chain.transactions.pageSize
              )
              dispatch({
                type: NeuronWalletActions.Chain,
                payload: { transactions: { ...chain.transactions, items: newTransactionItems } },
              })
            } else {
              const newTransactionItems = [...chain.transactions.items]
              const idx = newTransactionItems.findIndex(item => item.hash === updatedTransaction.hash)
              if (idx >= 0) {
                newTransactionItems[idx] = updatedTransaction
                dispatch({
                  type: NeuronWalletActions.Chain,
                  payload: { transactions: { ...chain.transactions, items: newTransactionItems } },
                })
              }
            }
            if (chain.transaction.hash === updatedTransaction.hash) {
              dispatch({
                type: NeuronWalletActions.Chain,
                payload: { transaction: updatedTransaction },
              })
            }
            break
          }
          default: {
            break
          }
        }
      }
    })

    UILayer.on(Channel.Wallets, (_e: Event, method: WalletsMethod, args: ChannelResponse<any>) => {
      if (args.status) {
        switch (method) {
          case WalletsMethod.Create:
          case WalletsMethod.ImportMnemonic:
          case WalletsMethod.Update: {
            let template = ''
            if (method === WalletsMethod.Create) {
              template = 'messages.wallet-created-successfully'
            } else if (method === WalletsMethod.Update) {
              template = 'messages.wallet-updated-successfully'
            } else {
              template = 'messages.wallet-imported-successfully'
            }
            const content = i18n.t(template, { name: args.result.name })
            dispatch({
              type: AppActions.AddNotification,
              payload: {
                type: 'success',
                content,
                timestamp: Date.now(),
              },
            })
            history.push(Routes.Overview)
            break
          }
          case WalletsMethod.GetAll: {
            dispatch({
              type: NeuronWalletActions.Settings,
              payload: { wallets: args.result },
            })
            walletsCache.save(args.result)
            break
          }
          case WalletsMethod.GetCurrent: {
            dispatch({
              type: NeuronWalletActions.Wallet,
              payload: args.result,
            })
            currentWalletCache.save(args.result)
            break
          }
          case WalletsMethod.SendCapacity: {
            if (args.result) {
              history.push(Routes.History)
            }
            break
          }
          case WalletsMethod.SendingStatus: {
            dispatch({
              type: NeuronWalletActions.Wallet,
              payload: {
                sending: args.result,
              },
            })
            break
          }
          case WalletsMethod.GetAllAddresses: {
            const addresses = args.result || []
            dispatch({
              type: NeuronWalletActions.Wallet,
              payload: {
                addresses,
                balance: addressesToBalance(addresses),
              },
            })
            addressesCache.save(addresses)
            break
          }
          case WalletsMethod.RequestPassword: {
            dispatch({
              type: AppActions.RequestPassword,
              payload: {
                walletID: args.result.walletID || '',
                actionType: args.result.actionType || '',
              },
            })
            break
          }
          default: {
            break
          }
        }
      } else {
        if (!args.msg) {
          return
        }
        if (method === WalletsMethod.GetCurrent) {
          return
        }
        const { content } = typeof args.msg === 'string' ? { content: args.msg } : args.msg || { content: '' }
        dispatch({
          type: AppActions.AddNotification,
          payload: {
            type: 'alert',
            content,
            timestamp: Date.now(),
          },
        })
      }
    })

    UILayer.on(Channel.Networks, (_e: Event, method: NetworksMethod, args: ChannelResponse<any>) => {
      if (args.status) {
        switch (method) {
          case NetworksMethod.CurrentID: {
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: { networkID: args.result },
            })
            currentNetworkIDCache.save(args.result)
            break
          }
          case NetworksMethod.Create:
          case NetworksMethod.Update: {
            history.push(Routes.SettingsNetworks)
            break
          }
          case NetworksMethod.Activate: {
            dispatch({
              type: NeuronWalletActions.Chain,
              payload: { network: args.result },
            })
            break
          }
          default: {
            break
          }
        }
      } else {
        dispatch({
          type: AppActions.AddNotification,
          payload: {
            type: 'alert',
            content: args.msg,
            timestamp: Date.now(),
          },
        })
      }
    })
  }, [walletID, i18n, chain, dispatch, history])

export const useSyncChainData = ({ chainURL, dispatch }: { chainURL: string; dispatch: StateDispatch }) => {
  useEffect(() => {
    const syncTipNumber = () =>
      getTipBlockNumber()
        .then(tipBlockNumber => {
          dispatch({
            type: AppActions.UpdateTipBlockNumber,
            payload: tipBlockNumber,
          })
        })
        .catch(console.error)

    const syncBlockchainInfo = () => {
      getBlockchainInfo()
        .then(info => {
          if (info) {
            const { chain = '', difficulty = '', epoch = '', alerts = [] } = info
            if (alerts.length) {
              alerts.forEach(a => {
                // TODO: display alerts in Notification
                console.info(a)
              })
            }
            dispatch({
              type: AppActions.UpdateChainInfo,
              payload: {
                chain,
                difficulty,
                epoch,
              },
            })
          }
        })
        .catch(console.error)
    }
    clearInterval(timer)
    if (chainURL) {
      ckbCore.setNode(chainURL)
      syncTipNumber()
      syncBlockchainInfo()
      timer = setInterval(() => {
        syncTipNumber()
        syncBlockchainInfo()
      }, SYNC_INTERVAL_TIME)
    } else {
      ckbCore.setNode('')
    }
    return () => {
      clearInterval(timer)
    }
  }, [chainURL, dispatch])
}

export const useOnCurrentWalletChange = ({
  walletID,
  chain,
  i18n,
  history,
  dispatch,
}: {
  walletID: string
  chain: State.Chain
  i18n: any
  history: any

  dispatch: StateDispatch
}) => {
  const { pageNo, pageSize } = chain.transactions
  useEffect(() => {
    if (walletID) {
      walletsCall.getAllAddresses(walletID)
      transactionsCall.getAllByKeywords({
        walletID,
        keywords: '',
        pageNo,
        pageSize,
      })
    } else {
      initWindow()
        .then((initializedState: any) => {
          initializeApp({
            initializedState,
            i18n,
            history,
            dispatch,
          })
        })
        .catch((err: Error) => {
          console.error(err)
          history.push(`${Routes.WalletWizard}${WalletWizardPath.Welcome}`)
        })
    }
  }, [walletID, pageNo, pageSize, dispatch, i18n, history])
}

export const useSubscription = ({
  walletID,
  chain,
  dispatch,
}: {
  walletID: string
  chain: State.Chain
  dispatch: StateDispatch
}) => {
  const { pageNo, pageSize, keywords } = chain.transactions
  const { hash: txHash } = chain.transaction
  useEffect(() => {
    const systemScriptSubscription = SystemScriptSubject.subscribe(({ codeHash = '' }: { codeHash: string }) => {
      systemScriptCache.save({ codeHash })
      dispatch({
        type: NeuronWalletActions.UpdateCodeHash,
        payload: codeHash,
      })
    })
    const dataUpdateSubscription = DataUpdateSubject.subscribe(({ dataType, walletID: walletIDOfMessage }: any) => {
      if (walletIDOfMessage && walletIDOfMessage !== walletID) {
        return
      }
      switch (dataType) {
        case 'address': {
          walletsCall.getAllAddresses(walletID)
          break
        }
        case 'transaction': {
          transactionsCall.getAllByKeywords({
            walletID,
            keywords,
            pageNo,
            pageSize,
          })
          transactionsCall.get(walletID, txHash)
          break
        }
        case 'wallet': {
          walletsCall.getAll()
          walletsCall.getCurrent()
          break
        }
        case 'network': {
          networksCall.getAll()
          networksCall.currentID()
          break
        }
        default: {
          break
        }
      }
    })
    const networkListSubscription = NetworkListSubject.subscribe(({ currentNetworkList = [] }) => {
      dispatch({
        type: NeuronWalletActions.UpdateNetworkList,
        payload: currentNetworkList,
      })
      networksCache.save(currentNetworkList)
    })
    return () => {
      systemScriptSubscription.unsubscribe()
      dataUpdateSubscription.unsubscribe()
      networkListSubscription.unsubscribe()
    }
  }, [walletID, pageNo, pageSize, keywords, txHash, dispatch])
}

export default {
  useChannelListeners,
  useSyncChainData,
  useOnCurrentWalletChange,
  useSubscription,
}
