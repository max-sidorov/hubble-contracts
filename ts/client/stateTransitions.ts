import { BigNumber } from "ethers";
import { ZeroAmount, InsufficientFund, WrongTokenID } from "../exceptions";
import { State } from "../state";
import { TxTransfer } from "../tx";
import { sum } from "../utils";
import { StateStorageEngine } from "./storageEngine";

function applySender(sender: State, decrement: BigNumber): State {
    const state = sender.clone();
    state.balance = sender.balance.sub(decrement);
    state.nonce = sender.nonce.add(1);
    return state;
}
function applyReceiver(receiver: State, increment: BigNumber): State {
    const state = receiver.clone();
    state.balance = receiver.balance.add(increment);
    return state;
}

export function validateSender(
    state: State,
    tokenID: BigNumber,
    amount: BigNumber,
    fee: BigNumber
) {
    if (amount.isZero()) throw new ZeroAmount();
    const decrement = amount.add(fee);
    if (state.balance.lt(decrement))
        throw new InsufficientFund(
            `balance: ${state.balance}, tx amount+fee: ${decrement}`
        );
    if (!state.tokenID.eq(tokenID))
        throw new WrongTokenID(
            `Tx tokenID: ${tokenID}, State tokenID: ${state.tokenID}`
        );
}

export function validateReceiver(state: State, tokenID: BigNumber) {
    if (!state.tokenID.eq(tokenID))
        throw new WrongTokenID(
            `Tx tokenID: ${tokenID}, State tokenID: ${state.tokenID}`
        );
}

export async function processSender(
    senderID: BigNumber,
    tokenID: BigNumber,
    amount: BigNumber,
    fee: BigNumber,
    engine: StateStorageEngine
): Promise<void> {
    const state = await engine.get(senderID.toNumber());
    validateSender(state, tokenID, amount, fee);
    const decrement = amount.add(fee);
    const postState = applySender(state, decrement);
    await engine.update(senderID.toNumber(), postState);
}

export async function processReceiver(
    receiverID: BigNumber,
    increment: BigNumber,
    tokenID: BigNumber,
    engine: StateStorageEngine
): Promise<void> {
    const state = await engine.get(receiverID.toNumber());
    validateReceiver(state, tokenID);
    const postState = applyReceiver(state, increment);
    await engine.update(receiverID.toNumber(), postState);
}

async function processTransfer(
    tx: TxTransfer,
    tokenID: BigNumber,
    engine: StateStorageEngine
): Promise<void> {
    await processSender(
        BigNumber.from(tx.fromIndex),
        tokenID,
        tx.amount,
        tx.fee,
        engine
    );
    await processReceiver(
        BigNumber.from(tx.toIndex),
        tx.amount,
        tokenID,
        engine
    );
}

export async function processTransferCommit(
    txs: TxTransfer[],
    feeReceiverID: number,
    engine: StateStorageEngine
): Promise<TxTransfer[]> {
    const tokenID = (await engine.get(feeReceiverID)).tokenID;
    let acceptedTxs = [];
    for (const tx of txs) {
        const checkpoint = engine.getCheckpoint();
        try {
            await processTransfer(tx, tokenID, engine);
            engine.commit();
            acceptedTxs.push(tx);
        } catch (err) {
            console.log("Drop tx due to ", err.message);
            engine.revert(checkpoint);
        }
    }
    const fees = sum(acceptedTxs.map(tx => tx.fee));
    await processReceiver(BigNumber.from(feeReceiverID), fees, tokenID, engine);
    return acceptedTxs;
}
