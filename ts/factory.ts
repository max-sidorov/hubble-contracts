import { BigNumber } from "ethers";
import { aggregate, BlsSigner } from "./blsSigner";
import { USDT } from "./decimal";
import { UserNotExist } from "./exceptions";
import { Domain, solG1 } from "./mcl";
import { State } from "./state";
import { nullProvider, StateProvider } from "./stateTree";
import {
    TxTransfer,
    TxCreate2Transfer,
    TxMassMigration,
    SignableTx
} from "./tx";

export class User {
    static new(domain: Domain, stateID: number, pubkeyID: number) {
        const signer = BlsSigner.new(domain);
        return new User(signer, stateID, pubkeyID);
    }
    constructor(
        public blsSigner: BlsSigner,
        public stateID: number,
        public pubkeyID: number
    ) {}
    public sign(tx: SignableTx) {
        return this.blsSigner.sign(tx.message());
    }
    get pubkey() {
        return this.blsSigner.pubkey;
    }
    toString() {
        return `<User stateID: ${this.stateID}  pubkeyID: ${this.pubkeyID}>`;
    }
}

interface GroupOptions {
    n: number;
    domain: Domain;
    stateProvider?: StateProvider;
    initialStateID?: number;
    initialPubkeyID?: number;
}

interface createStateOptions {
    initialBalance?: BigNumber;
    tokenID?: number;
    zeroNonce?: boolean;
}

export class Group {
    static new(options: GroupOptions) {
        const initialStateID = options.initialStateID || 0;
        const initialPubkeyID = options.initialPubkeyID || 0;
        const stateProvider = options.stateProvider || nullProvider;
        const users: User[] = [];
        for (let i = 0; i < options.n; i++) {
            const stateID = initialStateID + i;
            const pubkeyID = initialPubkeyID + i;
            users.push(User.new(options.domain, stateID, pubkeyID));
        }
        return new this(users, stateProvider);
    }
    constructor(private users: User[], private stateProvider: StateProvider) {}
    public connect(provider: StateProvider) {
        this.stateProvider = provider;
        return this;
    }
    get size() {
        return this.users.length;
    }
    public *userIterator() {
        for (const user of this.users) {
            yield user;
        }
    }
    public getUser(i: number) {
        if (i >= this.users.length) throw new UserNotExist(`${i}`);
        return this.users[i];
    }
    public getState(user: User) {
        return this.stateProvider.getState(user.stateID).state;
    }
    public syncState(): State[] {
        const states: State[] = [];
        for (const user of this.users) {
            const state = this.stateProvider.getState(user.stateID).state;
            states.push(state);
        }
        return states;
    }
    public createStates(options?: createStateOptions) {
        const initialBalance = options?.initialBalance || USDT.castInt(1000.0);
        const tokenID = options?.tokenID || 1;
        const zeroNonce = options?.zeroNonce || false;
        const arbitraryInitialNonce = 9;
        for (let i = 0; i < this.users.length; i++) {
            const user = this.users[i];
            const nonce = zeroNonce ? 0 : arbitraryInitialNonce + i;
            const state = State.new(
                user.pubkeyID,
                tokenID,
                initialBalance,
                nonce
            );
            this.stateProvider.createState(user.stateID, state);
        }
    }
}

// Created n transfers from Group of Users, if n is greater than the size of the group, balance is not guaranteed to be sufficient
export function txTransferFactory(
    group: Group,
    n: number
): { txs: TxTransfer[]; signature: solG1; senders: User[] } {
    const txs: TxTransfer[] = [];
    const signatures = [];
    const senders = [];
    for (let i = 0; i < n; i++) {
        const sender = group.getUser(i % group.size);
        const receiver = group.getUser((i + 5) % group.size);
        const senderState = group.getState(sender);
        const amount = senderState.balance.div(10);
        const fee = amount.div(10);
        const tx = new TxTransfer(
            sender.stateID,
            receiver.stateID,
            amount,
            fee,
            senderState.nonce,
            USDT
        );
        txs.push(tx);
        signatures.push(sender.sign(tx));
        senders.push(sender);
    }
    const signature = aggregate(signatures).sol;
    return { txs, signature, senders };
}

// creates N new transactions with existing sender and non-existent receiver
export function txCreate2TransferFactory(
    registered: Group,
    unregistered: Group
): { txs: TxCreate2Transfer[]; signature: solG1 } {
    const txs: TxCreate2Transfer[] = [];
    const signatures = [];
    const n = Math.min(registered.size, unregistered.size);
    for (let i = 0; i < n; i++) {
        const sender = registered.getUser(i);
        const reciver = unregistered.getUser(i);
        const senderState = registered.getState(sender);
        const amount = senderState.balance.div(10);
        const fee = amount.div(10);

        // uses states for sender
        // and newStates for receiver as they are not created yet
        const tx = new TxCreate2Transfer(
            sender.stateID,
            reciver.stateID,
            reciver.pubkey,
            reciver.pubkeyID,
            amount,
            fee,
            senderState.nonce,
            USDT
        );
        txs.push(tx);
        signatures.push(sender.sign(tx));
    }
    const signature = aggregate(signatures).sol;
    return { txs, signature };
}

export function txMassMigrationFactory(
    group: Group,
    spokeID = 0
): { txs: TxMassMigration[]; signature: solG1; senders: User[] } {
    const txs: TxMassMigration[] = [];
    const signatures = [];
    const senders = [];
    for (const sender of group.userIterator()) {
        const senderState = group.getState(sender);
        const amount = senderState.balance.div(10);
        const fee = amount.div(10);
        const tx = new TxMassMigration(
            sender.stateID,
            amount,
            spokeID,
            fee,
            senderState.nonce,
            USDT
        );
        txs.push(tx);
        signatures.push(sender.sign(tx));
        senders.push(sender);
    }
    const signature = aggregate(signatures).sol;
    return { txs, signature, senders };
}
