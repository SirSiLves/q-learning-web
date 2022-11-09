import { Injectable } from '@angular/core';
import { Action, TttMatrixModel } from '../state/ttt-matrix.model';
import * as tf from '@tensorflow/tfjs';
import { Tensor2D } from '@tensorflow/tfjs';
import { TttMatrixStore } from '../state/ttt-matrix.store';
import { TttMatrixService } from '../state/ttt-matrix.service';
import { MazeRandomService } from '../../maze/ai/maze-random.service';
import { TttRandomService } from './ttt-random.service';

@Injectable({
  providedIn: 'root'
})
export class TttTensorflowService {

  // https://app.pluralsight.com/course-player?clipId=7f3fb943-4549-4a00-a12a-aa0d60fd1ea0
  // https://www.youtube.com/watch?v=5fHngyN8Qhw
  // https://www.mlq.ai/deep-reinforcement-learning-for-trading-with-tensorflow-2-0/
  // https://www.guru99.com/tensor-tensorflow.html#5
  // https://github.com/moduIo/Deep-Q-network/blob/master/DQN.ipynb

  // q-learning hyperparameters
  private readonly alpha = 0.3; // a-learning rate between 0 and 1
  private readonly gamma = 0.9; // y-discount factor between 0 and 1
  private epsilon = 0.3; // exploitation vs exploration between 0 and 1
  private readonly epsilonDecay = 0.01; // go slightly for more exploitation instead of exploration
  private readonly epsilonDecrease = false; // go slightly for more exploitation instead of exploration

  // TODO batch
  private replayBuffer: {
    state: Tensor2D,
    actions: Tensor2D
  }[] = [];

  private readonly NUM_BOARD_HEIGHT = 3;
  private readonly NUM_BOARD_WIDTH = 3;
  private readonly NUM_MOVES = 9;

  private tf = tf;
  private model: any;

  constructor() {
    this.buildModel();
  }

  private buildModel(): void {
    // define network-model
    this.model = this.tf.sequential();
    this.model.add(
      tf.layers.dense({
        inputShape: [this.NUM_BOARD_HEIGHT * this.NUM_BOARD_WIDTH], // concated board size, single array of board
        units: 9,
        activation: 'relu'
      })
    );

    this.model.add(
      tf.layers.dense({
        units: 200,
        activation: 'relu'
      })
    );

    this.model.add(
      tf.layers.dense({
        units: 200,
        activation: 'relu'
      })
    );

    this.model.add(
      tf.layers.dense({
        units: this.NUM_MOVES, // num of actions
        activation: 'sigmoid'
      })
    );

    this.model.compile({
      optimizer: this.tf.train.adam(0.001),
      loss: tf.losses.meanSquaredError,
      metrics: ['mse']
    });

    console.log('model created');

    // this.model.save('downloads://my-model'); // https://www.tensorflow.org/js/guide/save_load
  }


  private getFlattedBoard(matrix: number[][]): number[] {
    let flattedBoard: number[] = [];
    for (let key in matrix) flattedBoard = flattedBoard.concat(matrix[key]);

    return flattedBoard;
  }

  private getTensorFromState(matrix: number[]): Tensor2D {
    return tf.tensor2d(matrix, [1, this.NUM_BOARD_HEIGHT * this.NUM_BOARD_WIDTH]);
  }

  private async getQValuesFromState(matrix: number[][]): Promise<any> {
    const tensor = this.getTensorFromState(this.getFlattedBoard(matrix));

    return tf.tidy(() => {
      // get q-values for each action
      return this.model.predict(tensor).dataSync();
    });
  }


  train(startState: number[][], episodes: number, isPlaying: number): void {
    if (episodes <= 0) return;

    let state = TttMatrixService.copyState(startState);

    // 1. get q-values with predict from stateX
    this.getQValuesFromState(state).then((qValues: any) => {

      // 2. take the action with the highest q-value
      const action: Action = this.chooseActionWithEpsilonGreedy(qValues);

      // 3. execute action && get reward from executed action
      const reward = TttMatrixService.getActionReward(state, isPlaying, action);
      let newState = TttMatrixService.copyState(state);
      if (reward !== TttMatrixService.INVALID_REWARD) {
        // execute action only if it is a valid action
        newState = TttMatrixService.doAction(newState, action, isPlaying);
      }

      // 4. update q-value with returned reward on chosen action
      const newQValues = this.calculateQValues(qValues, reward, action, newState);

      // 5. fit model with stateX and updated q-value list
      this.updateQValues(newQValues, state).then(trainHistory => {

        if (TttMatrixService.winnerOrDraw(state)) {
          if (this.epsilonDecrease) this.epsilon = Math.max(this.epsilon - this.epsilonDecay, 0);

          console.log(episodes, this.epsilon, trainHistory.history.loss);

          // 6.1 go to step 1. with init state decrease episode
          this.train(TttMatrixStore.initState, episodes - 1, isPlaying === 1 ? 2 : 1);

        } else {
          // 6.2 go to step 1. with stateX+1

          if (reward === TttMatrixService.INVALID_REWARD) {
            // it's an impossible move try one more time
            this.train(newState, episodes, isPlaying);
          } else {
            newState = this.executeOpponentMove(newState, isPlaying === 1 ? 2 : 1);
            this.train(newState, episodes, isPlaying);
          }
        }
      });
    });
  }

  private chooseActionWithEpsilonGreedy(qValues: any): Action {
    const actions: Action[] = TttMatrixService.getActions();

    // exploitation vs exploration, if random is smaller than epsilon go for exploration
    const random = MazeRandomService.generateRandomNumber(0, 10) / 10; // between 0 & 1

    if (random < this.epsilon) {
      // take random move
      return actions[MazeRandomService.generateRandomNumber(0, actions.length - 1)];
    } else {
      // take best move
      return this.getQMaxAction(actions, qValues);
    }
  }

  private calculateQValues(qValues: number[], reward: number, action: Action, newState: number[][]): number[] {
    const oldQValue = qValues[action];
    const qMaxWithNewState = this.getQValueMaxFromState(newState);
    const newQValue = oldQValue + this.alpha * (reward + this.gamma * qMaxWithNewState - oldQValue);

    const newQValues = [...qValues];
    newQValues[action] = newQValue;

    return newQValues;
  }

  private getQValueMaxFromState(newState: number[][]): number {
    const stateTensor = this.getTensorFromState(this.getFlattedBoard(newState));
    const prediction = this.model.predict(stateTensor).dataSync();

    return Math.max(...prediction);
  }

  private updateQValues(newQValues: number[], state: number[][]): Promise<any> {
    const stateTensor = this.getTensorFromState(this.getFlattedBoard(state));
    const actionQTensor = tf.tensor2d([newQValues], [1, TttMatrixService.getActions().length]);

    return this.model.fit(stateTensor, actionQTensor, {epochs: 1});
  }

  predict(state: number[][], isPlaying: number): Action {
    const stateTensor = this.getTensorFromState(this.getFlattedBoard(state));
    const actionQValues = this.model.predict(stateTensor).dataSync();
    const bestAction = this.getQMaxAction(TttMatrixService.getActions(), actionQValues);

    console.log('PREDICT', actionQValues, bestAction, TttMatrixService.getActionReward(state, isPlaying, bestAction));

    if (TttMatrixService.getActionReward(state, isPlaying, bestAction) === TttMatrixService.INVALID_REWARD) {
      // it's an impossible move make a random move
      console.warn('random move');
      const actionsRewards: { action: Action, reward: number }[] = TttMatrixService.getActions().map(action => {
        return {
          action: action,
          reward: TttMatrixService.getActionReward(
            state, isPlaying, action
          )
        }
      });

      const filteredActionRewards = actionsRewards.filter(ar => ar.reward !== TttMatrixService.INVALID_REWARD); // filter impossible moves
      return filteredActionRewards[TttRandomService.generateRandomNumber(0, filteredActionRewards.length - 1)].action;
    }

    return bestAction;
  }

  private getQMaxAction(actions: Action[], qValues: number[]): Action {
    let actionIndex: Action = 0;
    let actionMax: number = qValues[actionIndex];

    for (let i = 0; i < qValues.length; i++) {
      if (qValues[i] > actionMax) {
        actionMax = actions[i];
        actionIndex = i;
      }
    }

    return actions[actionIndex];
  }

  private executeOpponentMove(newState: number[][], isPlaying: number) {
    return TttRandomService.makeRandomAction(newState, isPlaying);
  }


  // TESTING
  test(tttMatrixModel: TttMatrixModel): void {

    // Workflow
    // 1. get q-values with predict from state1
    // 2. take the action with the highest q-value
    // 3. execute action
    // 4. get reward from executed action
    // 5. update q-value with returned reward on chosen action
    // 6. fit model with state1 and updated q-value list
    // 7. get q-values with predict from state2 ...
    // ... go further on step 2.

    let board: number[] = this.getFlattedBoard(TttMatrixStore.initState);
    let x = tf.tensor2d(board, [1, 9]);

    let actionValues = [0, 0, 0, 0, 0, 0, 0, 0, 0] // Q-Values for each possible action
    let y = tf.tensor2d([actionValues], [1, 9]); // 9 = num of actions

    this.model.fit(x, y, {epochs: 1}).then((test: any) => {
      console.log('fit', test);

      tf.tidy(() => {
        let nextBoard: any = [];
        for (let key in tttMatrixModel.state) nextBoard = nextBoard.concat(TttMatrixStore.initState[key]);
        let z = tf.tensor2d(board, [1, 9]);

        const pred = this.model.predict(z).dataSync(); // get q-values for each action
        console.log('predict', pred);
      });
    });
  }
}