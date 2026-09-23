import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, IdentifierSchema, HashSchema,
} from './common.js';

export const ArtifactSetSchema = artifactObject('artifact-set', {
  artifactSetId: IdentifierSchema,
  semanticWorkflowHash: HashSchema,
  artifacts: Type.Array(strictObject({
    artifactId: IdentifierSchema,
    nodeId: IdentifierSchema,
    artifactHash: HashSchema,
  }), { maxItems: 4096 }),
});
export type ArtifactSet = Static<typeof ArtifactSetSchema>;
