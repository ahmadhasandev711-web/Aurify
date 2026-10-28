export {
  transitionReturn,
  validateInspection,
  validateApproval,
  restockMovements,
} from './domain/return-state-machine';
export type {
  ReturnStatus,
  ReturnEvent,
  InspectionItem,
  InspectionError,
  ReturnTransitionResult,
} from './domain/return-state-machine';
