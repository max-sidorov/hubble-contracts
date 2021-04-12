import { allContracts } from "../../allContractsInterfaces";
import { DeploymentParameters } from "../../interfaces";
import { sleep } from "../../utils";
import { TransferPackingCommand, TransferPool } from "../features/transfer";
import { SyncedPoint } from "../node";
import { StorageManager } from "../storageEngine";
import { BaseService } from "./base";

export class Packer extends BaseService {
    packingCommand: TransferPackingCommand;
    name = "Packer";

    constructor(
        private readonly storageManager: StorageManager,
        private readonly parameters: DeploymentParameters,
        private readonly contracts: allContracts,
        private readonly pool: TransferPool,
        private syncpoint: SyncedPoint
    ) {
        super();
        this.packingCommand = new TransferPackingCommand(
            this.parameters,
            this.storageManager,
            this.pool,
            this.contracts.rollup
        );
    }

    async onRun() {
        if (this.pool.isEmpty()) {
            await sleep(10000);
            return;
        }
        try {
            const tx = await this.packingCommand.packAndSubmit();
            const receipt = await tx.wait(1);
            this.syncpoint.batchID += 1;
            this.syncpoint.blockNumber = receipt.blockNumber;
        } catch (err) {
            this.log(`Packing failed ${err}`);
        }
    }
}
