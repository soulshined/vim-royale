import dotenv from 'dotenv';
dotenv.config();

import * as blessed from 'blessed';

import PositionComponent from './objects/components/position';
import System from './systems/System';
import { StartGameMessage } from './server/commands';
import { isCorrectPosition, readCorrectPosition } from './server/messages/correctPosition';
import { isGameStateUpdate, readGameStateUpdate } from './server/messages/game-state-update';
import { MapLayout }from './server/commands';
import createRenderSystem from './systems/ClientRenderSystem';
import MovementSystem from './systems/ClientMovementSystem';
import getEvents, {EventType, BinaryData, EventData, Run} from './events';
import captureInput from './input/index';
import createMainMenu from './screen/main-menu';

import Player from './objects/player';
import ClientSocket from './client-socket';
import getEntityStore from './entities';
import GlobalContext from './context';
import Board from './board';

let movement: MovementSystem;
let renderer;
let board: Board;
let player: Player;

const systems: System[] = [];
const store = getEntityStore();

function loop(eventData: Run) {
    const then = Date.now();
    systems.forEach(s => {
        s.run(eventData);
    });

    console.error("TimeToRender", Date.now() - then);
}

try {
    const events = getEvents();
    const screen = blessed.screen({
        smartCSR: true
    });

    screen.title = 'Vim Royale';

    process.on('uncaughtException', function(err) {
        console.error(err.message);
        console.error(err.stack);
    });

    GlobalContext.socket = new ClientSocket()
    captureInput(screen);
    createMainMenu(systems, screen);

    events.on((evt, ...args) => {
        switch (evt.type) {
            case EventType.StartGame:
                createMainGame(evt.data);
                break;

            case EventType.WsBinary:
                handleBinaryMessage(evt);
                break;

            case EventType.Run:
                loop(evt);
                break;
        }
    });

    // TODO: Stop using globals and just get your act together.  Also those
    // arnt globals, those are technically module level data, which some
    // people, not REACTJS, think is fine to use (IE. SVELLLLTEEE)
    function handleBinaryMessage(evt: BinaryData) {
        if (isCorrectPosition(evt.data, 0)) {
            const posCorrection = readCorrectPosition(evt.data, 1);

            player.forcePosition.x = posCorrection.x;
            player.forcePosition.y = posCorrection.y;
            player.forcePosition.movementId = posCorrection.nextId;
            player.forcePosition.force = true;
        }

        else if (isGameStateUpdate(evt.data, 0)) {
            console.error("StateBuffer", evt.data);
            const stateUpdate = readGameStateUpdate(evt.data, 1);
            console.error("StateUpdate", stateUpdate);

            let posComponent;
            if (store.setNewEntity(stateUpdate.entityId)) {
                posComponent = new PositionComponent(
                    stateUpdate.char, stateUpdate.x, stateUpdate.y);

                store.attachComponent(stateUpdate.entityId, posComponent);
            }

            // TODO: Fix me
            // @ts-ignore
            posComponent = store.getComponent(
            // @ts-ignore
                stateUpdate.entityId, PositionComponent) as PositionComponent;

            posComponent.x = stateUpdate.x;
            posComponent.y = stateUpdate.y;
            loop({} as Run);
        }
    }

    function createMainGame(data: StartGameMessage) {
        board = new Board(data.map.map);
        store.setEntityRange(data.entityIdRange[0], data.entityIdRange[1]);

        const startingPosition = data.position;
        player = new Player(startingPosition[0], startingPosition[1], '@');

        GlobalContext.player = player;
        GlobalContext.screen = "board";

        renderer = createRenderSystem(screen, board);
        movement = new MovementSystem(board);

        systems.push(movement);
        systems.push(renderer);

        GlobalContext.socket.createEntity(
            player.entity, player.position.x, player.position.y);

    }
} catch (e) {
    console.error(e);
}
