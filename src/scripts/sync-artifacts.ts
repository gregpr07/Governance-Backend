import { refreshArtifacts } from '../utils/artifact-utils';

const contractToSync = ['GovernanceVotePower', 'PollingReject', 'PollingAccept', 'wNat'];

refreshArtifacts(contractToSync)
   .then(() => process.exit(0))
   .catch((error) => {
      console.error(error);
      process.exit(1);
   });
