<script>
import {
    record,
    mirror
} from 'rrweb';
import {
    onMount,
    onDestroy
} from 'svelte';
import {
    TransporterEvents
} from '@syncit/transporter/es/base';
import {
    applyMirrorAction,
    SourceBuffer,
    createEmbedService,
    createEmbedControlService,
    RemoteControlActions,
} from '@syncit/core';
import {
    customAlphabet
} from 'nanoid';
import {
    setCurrentLanguage
} from './locales';

export let createTransporter;
export let lang;

const nanoid = customAlphabet('1234567890abcdef', 10);
let uid = nanoid(8);
const transporter = createTransporter({
    uid,
    role: 'embed',
});
export let controls;
let ref;
$: ref && document.body.appendChild(ref);

const buffer = new SourceBuffer({
    onTimeout(record) {
        transporter.sendRecord(record);
    },
});

const service = createEmbedService({
    transporter,
    record,
    stopRecordFn: null,
    buffer,
});
let current = service.state;
const controlService = createEmbedControlService({
    record,
});
let controlCurrent = controlService.state;

onMount(() => {
    if (lang) {
        setCurrentLanguage(lang);
    }

    service.start();
    service.subscribe(state => {
        current = state;
        controls({
            current
        })
    });
    controlService.start();
    controlService.subscribe(state => {
        controlCurrent = state;
        controls({
            controlCurrent,
            controlService,
            service
        })
    });

    transporter.on(TransporterEvents.MirrorReady, () => {
        transporter.sendSourceReady();
    });
    transporter.on(TransporterEvents.Start, () => {
        service.send('CONNECT');
    });
    transporter.on(TransporterEvents.AckRecord, ({
        payload
    }) => {
        buffer.delete(payload);
    });
    transporter.on(TransporterEvents.RemoteControl, ({
        payload
    }) => {
        switch (payload.action) {
            case RemoteControlActions.Request:
                controlService.send('REQUEST');
                break;
            case RemoteControlActions.Stop:
                controlService.send('STOP');
                break;
            default:
                applyMirrorAction(mirror, payload);
                break;
        }
    });
});
onDestroy(() => {
    service.stop();
    controlService.stop();
});
</script>



