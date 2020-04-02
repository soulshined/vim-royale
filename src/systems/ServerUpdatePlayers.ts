import GlobalContext, {LocalContext} from '../context';

import getMovement from '../input/getMovement';
import PC, {blankPosition} from '../objects/components/position';
import NSC from '../objects/components/network-sync';
import createGameUpdate, {PLAYER_MOVEMENT_SIZE} from '../server/messages/game-state-update';
import BufferWriter from '../server/messages/buffer-writer';
import {TrackingInfo} from '../types';
import Board from '../board';
import getLogger from '../logger';

const logger = getLogger("ServerUpdatePlayers");

const obj = {
    entityId: 0,
    // TODO: If we scale everything this will have to be rethought of
    char: 'x',
    x: 0,
    y: 0,
};

class BufferPool {
    private pool: BufferWriterWrapper[];
    private factory: (pool: BufferPool) => BufferWriterWrapper;
    constructor(factory: (pool: BufferPool) => BufferWriterWrapper) {
        this.pool = [];
        this.factory = factory;
    }

    public malloc() {
        if (this.pool.length === 0) {
            this.pool.push(this.factory(this));
        }
        return this.pool.pop();
    }

    public free(buf: BufferWriterWrapper) {
        this.pool.push(buf);
    }
}

class BufferWriterWrapper {
    private pool: BufferPool;

    public detachCallback: () => void;
    public writer: BufferWriter;

    constructor(size: number, pool: BufferPool) {
        this.pool = pool;

        this.writer = new BufferWriter(size);
        this.detachCallback = this.detach.bind(this);
    }

    private detach() {
        this.writer.reset();
        this.pool.free(this);
    }
}

const pool = new BufferPool(function(pool: BufferPool): BufferWriterWrapper {
    return new BufferWriterWrapper(PLAYER_MOVEMENT_SIZE, pool);
});

const { width, height } = GlobalContext.display;
function isWithinUpdateDistance(a: PC, b: PC): boolean {
    return Math.abs(a.x - b.x) < width &&
        Math.abs(a.y - b.y) < height;
}

export default class ServerUpdatePlayers {
    private board: Board;
    private context: LocalContext;

    constructor(board: Board, context: LocalContext) {
        this.board = board;
        this.context = context;
    }

    run(listOfTrackingInfos: TrackingInfo[]) {
        this.context.store.forEach(NSC, (entityId, component: NSC) => {
            const pos = this.context.store.getComponent<PC>(entityId, PC);

            obj.entityId = entityId;
            obj.char = pos.char[0][0];
            obj.x = pos.x;
            obj.y = pos.y;

            for (let i = 0; i < listOfTrackingInfos.length; ++i) {
                const tracking = listOfTrackingInfos[i];
                const playerEntityId = tracking.entityIdRange[0];

                if (entityId >= playerEntityId &&
                    entityId < tracking.entityIdRange[1]) {
                    continue;
                }

                let main: PC;
                if (process.env.MAP === 'true') {
                    main = GlobalContext.activePlayers[playerEntityId];
                } else {
                    main = this.context.store.getComponent<PC>(playerEntityId, PC);
                }

                if (!main) {
                    // this does happen when the player has yet to upload their
                    // before another player has sent an update...
                    continue;
                }

                // This... This is naughty...  Not all things should be
                // updated.  Specifically when it comes to bullets.  Just
                // because i am dressed this way, does not mean, your buffer
                // can hold my ascii
                if (isWithinUpdateDistance(main, pos)) {
                    const buf = pool.malloc();
                    const playerData = createGameUpdate.
                        entityPositionUpdate(obj, buf.writer);

                    // TODO: Make sure that all this object creation does not F me.
                    tracking.ws.send(playerData, buf.detachCallback);
                }
            };
        });
    }
}


