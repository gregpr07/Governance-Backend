import { Column, Entity, Index } from "typeorm";
import { Proposal, PollingContractType } from "../dto/Proposal";
import { ProposalStateOptions, ProposalVotingStatus } from "../utils/enums";
import { BIPS, toBN, toHex } from "../utils/utils";
import { BaseEntity } from "./BaseEntity";

@Entity({ name: "proposal" })
export class DBProposal extends BaseEntity {
  @Column({ nullable: false }) @Index() contract: string;
  @Column({ nullable: false }) @Index() proposalId: string;
  @Column({ nullable: false }) @Index() pollingType: string; // PollingContractType
  @Column({ nullable: false }) @Index() proposer: string;
  @Column({ nullable: false }) targets: string; // serialized array of hex values
  @Column({ nullable: false }) values: string; // serialized array of hex values
  @Column({ nullable: false }) signatures: string; // serialized array of hex values
  @Column({ nullable: false }) calldatas: string; // serialized array of hex values
  @Column({ nullable: false }) @Index() startTime: number;
  @Column({ nullable: false }) @Index() endTime: number;
  @Column({ nullable: false }) description: string;
  @Column({ nullable: false }) @Index() votePowerBlock: number;
  @Column({ nullable: false }) votePowerBlockTs: number;
  @Column({ nullable: false }) @Index() wrappingThreshold: number;
  @Column({ nullable: false }) @Index() absoluteThreshold: number;
  @Column({ nullable: false }) @Index() relativeThreshold: number;
  @Column({ nullable: false }) @Index() totalVotePower: string;
  @Column({ nullable: false }) @Index() execStartTime: number;
  @Column({ nullable: false }) @Index() execEndTime: number;
  @Column({ nullable: false }) @Index() executableOnChain: boolean;
  @Column({ nullable: false }) @Index() executed: boolean;
  @Column({ nullable: false }) @Index() for: string;
  @Column({ nullable: false }) @Index() against: string;
  @Column({ nullable: false }) @Index() abstain: string;

  static fromEvent(event: any, votingType: PollingContractType, blockTs: number): DBProposal {
    const entity = new DBProposal();
    let params = event.returnValues;
    entity.contract = toHex(event.address);
    entity.pollingType = votingType;
    entity.proposalId = toHex(params.proposalId, 32);
    entity.proposer = params.proposer;
    entity.targets = JSON.stringify(params.targets);
    entity.values = JSON.stringify(params.values.map((x) => toHex(x, 32)));
    entity.signatures = JSON.stringify(params.signatures);
    entity.calldatas = JSON.stringify(params.calldatas);
    entity.startTime = parseInt(params.startTime);
    entity.endTime = parseInt(params.endTime);
    entity.description = params.description.slice(0,64);
    entity.votePowerBlock = parseInt(params.votePowerBlock);
    entity.votePowerBlockTs = blockTs;
    entity.wrappingThreshold = parseInt(params.wrappingThreshold);
    entity.absoluteThreshold = parseInt(params.absoluteThreshold);
    entity.relativeThreshold = parseInt(params.relativeThreshold);
    // fields to be updated by contract reads
    entity.execStartTime = 0;
    entity.execEndTime = 0;
    entity.totalVotePower = "0x0";
    entity.executableOnChain = false;
    entity.executed = false;
    entity.for = "0x0";
    entity.against = "0x0";
    entity.abstain = "0x0";
    return entity;
  }

  // Update as you go. Settings are never updated, once they are changed
  static updateEntityByProposalInfo(entity: DBProposal, proposalInfoData: any) {
    if (!entity.proposer) {
      entity.proposer = proposalInfoData._proposer;
    }
    if (entity.votePowerBlock === 0) {
      entity.votePowerBlock = parseInt(proposalInfoData._votePowerBlock);
    }
    if (entity.startTime === 0) {
      entity.startTime = parseInt(proposalInfoData._voteStartTime);
    }
    if (entity.endTime === 0) {
      entity.endTime = parseInt(proposalInfoData._voteEndTime);
    }
    if (entity.execStartTime === 0) {
      entity.execStartTime = parseInt(proposalInfoData._execStartTime || "0");
    }
    if (entity.execEndTime === 0) {
      entity.execEndTime = parseInt(proposalInfoData._execEndTime || "0");
    }
    entity.executed = proposalInfoData._executed;
  }

  static updateEntityByProposalVPData(
    entity: DBProposal,
    proposalInfoData: any
  ) {
    entity.totalVotePower = toHex(proposalInfoData._totalVP);
    entity.for = toHex(proposalInfoData._for);
    entity.against = toHex(proposalInfoData._against);
    entity.abstain = toHex(proposalInfoData._abstain);
  }

  /**
   * Method from PoolingAccept.sol indicating if proposal succeeded
   */
  acceptProposalSucceeded(): boolean {
    if (
      toBN(this.for).lt(
        toBN(this.absoluteThreshold)
          .mul(toBN(this.totalVotePower))
          .div(toBN(BIPS))
      )
    ) {
      return false;
    }
    if (
      toBN(this.for).lte(
        toBN(this.relativeThreshold)
          .mul(toBN(this.for).add(toBN(this.against)))
          .div(toBN(BIPS))
      )
    ) {
      return false;
    }
    return true;
  }

  /**
   * Method from PoolingReject.sol indicating if this succeeded
   */
  rejectProposalSucceeded(): boolean {
    if (
      toBN(this.against).lt(
        toBN(this.absoluteThreshold)
          .mul(toBN(this.totalVotePower))
          .div(toBN(BIPS))
      )
    ) {
      return true;
    }
    if (
      toBN(this.against).lte(
        toBN(this.relativeThreshold)
          .mul(toBN(this.for).add(toBN(this.against)))
          .div(toBN(BIPS))
      )
    ) {
      return true;
    }
    return false;
  }

  /**
   * This method is just a js implementation of the method in governance
   */
  proposalStatus(): ProposalStateOptions {
    if (this.executed) {
      return ProposalStateOptions.Executed;
    }
    const now = Math.floor(Date.now()/1000);

    if (this.startTime > now) {
      return ProposalStateOptions.Pending;
    }

    if (this.endTime > now) {
      return ProposalStateOptions.Active;
    }

    let succeeded = false;

    // status from PoolingAccept.sol
    if ((this.pollingType as PollingContractType) === "accept") {
      succeeded = this.acceptProposalSucceeded();
    }

    //   status from PoolingReject.sol
    if ((this.pollingType as PollingContractType) === "reject") {
      succeeded = this.rejectProposalSucceeded();
    }

    if (succeeded) {
      if (!this.executableOnChain) {
        return ProposalStateOptions.Queued;
      }
      if (this.execStartTime > now) {
        return ProposalStateOptions.Succeeded;
      }
      if (this.execEndTime > now) {
        return ProposalStateOptions.Queued;
      }
      return ProposalStateOptions.Expired;
    }

    return ProposalStateOptions.Defeated;
  }

  proposalVotingStatus(): ProposalVotingStatus {
    const now = Math.floor(Date.now()/1000);

    if (this.startTime > now) {
      return ProposalVotingStatus.Pending;
    }

    if (this.endTime > now) {
      return ProposalVotingStatus.Active;
    }

    let succeeded = false;

    // status from PoolingAccept.sol
    if ((this.pollingType as PollingContractType) === "accept") {
      succeeded = this.acceptProposalSucceeded();
    }

    //   status from PoolingReject.sol
    if ((this.pollingType as PollingContractType) === "reject") {
      succeeded = this.rejectProposalSucceeded();
    }

    if (succeeded) return ProposalVotingStatus.Succeeded;
    else return ProposalVotingStatus.Defeated;
  }


  public toDTO(voterAddress?: string, voterVotePower?: string): Proposal {
    return {
      contract: this.contract,
      pollingType: this.pollingType as PollingContractType,
      proposalId: this.proposalId,
      proposer: this.proposer,
      targets: JSON.parse(this.targets),
      values: JSON.parse(this.values),
      signatures: JSON.parse(this.signatures),
      calldatas: JSON.parse(this.calldatas),
      startTime: this.startTime,
      endTime: this.endTime,
      description: this.description,
      votePowerBlock: {
        blockNumber: this.votePowerBlock,
        blockTs: this.votePowerBlockTs
      },
      wrappingThreshold: this.wrappingThreshold,
      absoluteThreshold: this.absoluteThreshold,
      relativeThreshold: this.relativeThreshold,
      execStartTime: this.execStartTime,
      execEndTime: this.execEndTime,
      totalVotePower: this.totalVotePower,
      executableOnChain: this.executableOnChain,
      executed: this.executed,
      for: this.for,
      against: this.against,
      abstain: this.abstain,
      status: this.proposalVotingStatus(),
      voterAddress: voterAddress,
      voterVotePower: voterVotePower,
    };
  }
}

// event ProposalCreated(
//    uint256 proposalId,
//    address proposer,
//    address[] targets,
//    uint256[] values,
//    string[] signatures,
//    bytes[] calldatas,
//    uint256 startTime,
//    uint256 endTime,
//    string description,
//    uint256 votePowerBlock,
//    uint256 wrappingThreshold,
//    uint256 absoluteThreshold,
//    uint256 relativeThreshold
// );

// event ProposalCanceled(uint256 proposalId);

// event ProposalExecuted(uint256 proposalId);

// event ProposalThresholdSet(uint256 oldProposalThreshold, uint256 newProposalThreshold);
// event VotingDelaySet(uint256 oldVotingDelay, uint256 newVotingDelay);
// event VotingPeriodSet(uint256 oldVotingPeriod, uint256 newVotingPeriod);
// event ExecutionDelaySet(uint256 oldExecutionDelay, uint256 newExecutionDelay);
// event ExecutionPeriodSet(uint256 oldExecutionPeriod, uint256 newExecutionPeriod);
// event QuorumThresholdSet(uint256 oldQuorumThreshold, uint256 newQuorumThreshold);
// event VotePowerLifeTimeDaysSet(uint256 oldVotePowerLifeTimeDays, uint256 newVotePowerLifeTimeDays);
// event VpBlockPeriodSecondsSet(uint256 oldVpBlockPeriodSeconds, uint256 newVpBlockPeriodSeconds);

// struct Proposal {
//    address proposer;           // address of the proposer
//    uint256 votePowerBlock;     // block number used for identifying vote power
//    uint256 voteStartTime;      // start time of voting window (in seconds from epoch)
//    uint256 voteEndTime;        // end time of voting window (in seconds from epoch)
//    uint256 execStartTime;      // start time of execution window (in seconds from epoch)
//    uint256 execEndTime;        // end time of execution window (in seconds from epoch)
//    bool executableOnChain;     // flag indicating if proposal is executable on chain (via execution parameters)
//    bool executed;              // flag indicating if proposal has been executed
//    uint256 absoluteThreshold;  // Percentage in BIPS of the total vote power required for proposal "quorum"
//    uint256 relativeThreshold;  // Percentage in BIPS of the proper relation between FOR and AGAINST votes
//    uint256 totalVP;            // total vote power at votePowerBlock
// }
