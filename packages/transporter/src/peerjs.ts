/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import './parcel-require';
import Peer, { DataConnection } from 'peerjs';
import {
  Transporter,
  TransporterEvents,
  TransporterEventHandler,
} from './base';

export type PeerjsTransporterOptions = {
  uid: string;
  role: 'embed' | 'app';
  peerHost: string;
  peerPort: number;
  peerPath: string;
};

const sleep = (ms: number) =>
  new Promise(resolve =>
    setTimeout(() => {
      resolve();
    }, ms)
  );

export class PeerjsTransporter<T> implements Transporter<T> {
  handlers: Record<TransporterEvents, Array<TransporterEventHandler>> = {
    [TransporterEvents.SourceReady]: [],
    [TransporterEvents.MirrorReady]: [],
    [TransporterEvents.Start]: [],
    [TransporterEvents.SendRecord]: [],
    [TransporterEvents.AckRecord]: [],
    [TransporterEvents.Stop]: [],
    [TransporterEvents.RemoteControl]: [],
  };

  uid: string;
  role: PeerjsTransporterOptions['role'];
  peer: Peer;
  conn?: DataConnection;
  opened = false;
  temp: Array<any> = [];
  tempLength = 0;

  constructor(options: PeerjsTransporterOptions) {
    const { uid, role, peerHost, peerPort, peerPath } = options;
    this.uid = uid;
    this.role = role;
    this.peer = new Peer(`${this.uid}-${this.role}`, {
      host: peerHost,
      port: peerPort,
      path: peerPath,
      secure: true
    });
    this.peer.on('connection', conn => {
      this.conn = conn;
      conn.on('open', () => {
        this.opened = true;
        console.info('connection opened', Date.now());
      });
      conn.on('data', (data: any) => {
        const { event, payload } = data;
        this.handlers[event as TransporterEvents].map(h =>
          h({
            event: event,
            payload: payload,
          })
        );
      });
      conn.on('close', () => {
        console.info('connection closed');
        delete this.conn;
      });
      conn.on('error', e => {
        console.error(e);
      });
    });
  }

  get embedUid() {
    return `${this.uid}-embed`;
  }

  get appUid() {
    return `${this.uid}-app`;
  }

  connect() {
    return new Promise(resolve => {
      const targetId = `${this.uid}-${this.role === 'app' ? 'embed' : 'app'}`;
      const conn = this.peer.connect(targetId, {
        serialization: 'json',
      });
      conn.on('open', () => {
        console.info('connection opened', Date.now());
        this.conn = conn;
        resolve();
      });
      conn.on('data', (data: any) => {
        data = this.joinData(data);
        if (!data) return;
        const { event, payload } = data;
        this.handlers[event as TransporterEvents].map(h =>
          h({
            event: event,
            payload: payload,
          })
        );
      });

      conn.on('close', () => {
        console.info('connection closed');
        delete this.conn;
      });
      conn.on('error', e => {
        console.error(e);
      });
    });
  }

  joinData(data: any) {
    if (
      typeof data === 'string' &&
      data.startsWith('part') &&
      data.includes('endpart;')
    ) {
      const partData = data.split('endpart;');
      const index = parseInt(partData[0].split('-')[0].replace('part', ''), 10);
      const count = parseInt(partData[0].split('-')[1], 10);
      this.temp[index - 1] = partData[1];
      this.tempLength = this.tempLength + 1;
  
      if (this.tempLength !== count) return;
      data = JSON.parse(this.temp.join(''));
      this.temp = [];
      this.tempLength = 0;
    }
    return data;
  }

  async send<T>(data: T) {
    if (!this.conn) {
      await this.connect();
    }
    while (this.role === 'embed' && !this.opened) {
      // a spin lock to wait connection open
      await sleep(50);
    }
    let dataStr = JSON.stringify(data);
    const MAX_LENGTH = 200000;
    if (dataStr.length > MAX_LENGTH) {
      const count = Math.ceil(dataStr.length / MAX_LENGTH);
      for (let i = 0; i < count; i++) {
        const sendData = dataStr.slice(0, Math.min(dataStr.length, MAX_LENGTH));
        dataStr = dataStr.slice(Math.min(dataStr.length, MAX_LENGTH));

        this.conn?.send(`part${i + 1}-${count}endpart;${sendData}`);
      }
    } else {
      this.conn?.send(data);
    }
  }

  login(): Promise<boolean> {
    return Promise.resolve(true);
  }

  sendSourceReady() {
    return this.send({
      event: TransporterEvents.SourceReady,
    });
  }

  sendMirrorReady() {
    return this.send({
      event: TransporterEvents.MirrorReady,
    });
  }

  sendStart() {
    return this.send({
      event: TransporterEvents.Start,
    });
  }

  sendRecord(record: unknown) {
    return this.send({
      event: TransporterEvents.SendRecord,
      payload: record,
    });
  }

  ackRecord(id: number) {
    return this.send({
      event: TransporterEvents.AckRecord,
      payload: id,
    });
  }

  sendStop() {
    return this.send({
      event: TransporterEvents.Stop,
    });
  }

  sendRemoteControl(payload: unknown) {
    return this.send({
      event: TransporterEvents.RemoteControl,
      payload,
    });
  }

  on(event: TransporterEvents, handler: TransporterEventHandler) {
    this.handlers[event].push(handler);
  }
}
