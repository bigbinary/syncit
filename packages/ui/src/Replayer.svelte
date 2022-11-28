<script>
import {
    onMount,
    onDestroy
} from 'svelte';
import {
    MirrorBuffer,
    isIgnoredOnRmoteControl,
    createAppService,
} from '@syncit/core';
import {
    tick
} from 'svelte';
import {
    Replayer,
    EventType
} from 'rrweb';
import {
    TransporterEvents
} from '@syncit/transporter/es/base';
import {
    CustomEventTags,
    createAppControlService,
} from '@syncit/core';

export let transporter;
export let playerDom;
let replayer;
export let controlService;
export let controlCurrent;
export let bufferMs;
export let controls;

function getSizeOfString(str) {
    return encodeURI(str).split(/%(?:u[0-9A-F]{2})?[0-9A-F]{2}|./).length - 1;
}

function collectSize(timestamp, str) {
    if (sizes.length === 0) {
        sizes.push({
            x: Date.now(),
            y: 0
        });
    }
    const lastSize = sizes[sizes.length - 1];
    const size = getSizeOfString(str);
    if (timestamp - lastSize.x < 1000) {
        lastSize.y += size;
    } else {
        sizes.push({
            x: Date.now(),
            y: size
        });
    }
    sizes = sizes;
}

const buffer = new MirrorBuffer({
    bufferMs,
    onChunk({
        data
    }) {
        if (
            !controlCurrent.matches('controlling') ||
            !isIgnoredOnRmoteControl(data)
        ) {
            replayer.addEvent(data);
        }
    },
});
let latencies = [];
let sizes = [];

const service = createAppService(() => {
    replayer.pause();
    buffer.reset();
    latencies = [];
    sizes = [];
});
let current = service.state;
let sharingPDF = false;
let pdfEl;


onDestroy(() => {
    service.stop();
    controlService.stop();
});

function init() {
    transporter.on(TransporterEvents.SourceReady, () => {
        service.send('SOURCE_READY');
        replayer = new Replayer([], {
            root: playerDom,
            loadTimeout: 100,
            liveMode: true,
            insertStyleRules: [
                '.syncit-embed, #syncit-canvas, #syncit-pdf { display: none !important }',
            ],
            showWarning: true,
            showDebug: true,
            mouseTail: false,
        });
        controlService = createAppControlService({
            transporter,
            replayer,
        });
        controlCurrent = controlService.state;
        controlService.start();
        controlService.subscribe(state => {
            controlCurrent = state;
            controls({
                controlCurrent,
                controlService,
                current, 
                service
            })
        });

        transporter.sendStart();
    });

    transporter.on(TransporterEvents.SendRecord, data => {
        const {
            id,
            data: event,
            t
        } = data.payload;
        if (!current.matches('connected')) {
            replayer.startLive(event.timestamp - buffer.bufferMs);
            service.send('FIRST_RECORD');
        }
        if (event.type === EventType.Custom) {
            switch (event.data.tag) {
                case CustomEventTags.Ping:
                    latencies = latencies.concat({
                        x: t,
                        y: Date.now() - t
                    });
                    break;
                case CustomEventTags.AcceptRemoteControl:
                    controlService.send({
                        type: 'ACCEPTED',
                        payload: {
                            replayer
                        },
                    });
                    break;
                case CustomEventTags.StopRemoteControl:
                    controlService.send('STOP_CONTROL');
                    break;
                case CustomEventTags.OpenPDF:
                    sharingPDF = true;
                    tick().then(() => {
                        pdfEl.renderPDF({
                            dataURI: event.data.payload.dataURI
                        });
                    });
                    break;
                case CustomEventTags.ClosePDF:
                    sharingPDF = false;
                    break;
                default:
                    break;
            }
        }
        Promise.resolve().then(() => collectSize(t, JSON.stringify(event)));
        buffer.addWithCheck({
            id,
            data: event
        });
        transporter.ackRecord(id);
    });
    transporter.on(TransporterEvents.Stop, () => {
        service.send('STOP');
    });
}

onMount(() => {
    service.start();
    service.subscribe(state => {
        current = state;
        controls({
            current,
            service,
            controlCurrent,
            controlService,
        })
    });
    init();
});
</script>
