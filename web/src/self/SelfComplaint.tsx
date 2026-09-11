import { useEffect, useRef, useState } from 'react';
import {
  Button, Input, Select, Space, Tag, App, Modal, Empty, Spin, Switch,
  Segmented, DatePicker, Alert, Rate, Popconfirm,
} from 'antd';
import {
  PlusOutlined, CameraOutlined, AudioOutlined, EyeInvisibleOutlined, DeleteOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { selfApi } from './selfApi';
import { useSelfT } from './selfI18n';
import { useSelf } from './SelfApp';

const STATUS_COLOR: Record<string, string> = {
  NEW: 'red', ACCEPTED: 'orange', INVESTIGATING: 'blue',
  SUBSTANTIATED: 'green', UNSUBSTANTIATED: 'default',
  DUPLICATE: 'default', WITHDRAWN: 'default', CLOSED: 'default',
};

const AREAS = ['走廊', '公共卫生间', '洗衣房', '楼梯间', '活动室', '祷告室'];

/**
 * 员工投诉。
 *
 * 表单的顺序是按「工人站在走廊上用手机填」来排的：
 * 先选投诉什么 → 再选哪里 → 再选什么时候 → 证据 → 可选的文字。
 * 文字放在最后，因为很多工人不会打字 —— 拍张照按一下就能提交。
 */
export default function SelfComplaint() {
  const { t, cpStatus, dict, lang } = useSelfT();
  const { reload } = useSelf();
  const { message } = App.useApp();

  const [rows, setRows] = useState<any[] | null>(null);
  const [opts, setOpts] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [typeId, setTypeId] = useState<number>();
  const [where, setWhere] = useState<'ROOM' | 'PUBLIC'>('ROOM');
  const [roomId, setRoomId] = useState<number>();
  const [area, setArea] = useState<string>();
  const [when, setWhen] = useState<'LAST_NIGHT' | 'TODAY' | 'OTHER'>('LAST_NIGHT');
  const [customWhen, setCustomWhen] = useState<Dayjs | null>(null);
  const [desc, setDesc] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [files, setFiles] = useState<{ kind: 'PHOTO' | 'AUDIO'; mimeType: string; dataBase64: string; name: string; preview?: string }[]>([]);
  const [recording, setRecording] = useState(false);

  const photoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  const load = () => selfApi.complaints().then(setRows);
  useEffect(() => { load(); selfApi.complaintOptions().then(setOpts); }, []);

  const type = opts?.types?.find((x: any) => x.id === typeId);
  // 强制实名的类别，开关禁掉并说明原因 —— 不解释的话工人会以为系统坏了
  const canAnon = type ? type.allowAnonymous : true;
  useEffect(() => { if (!canAnon) setAnonymous(false); }, [canAnon]);

  const reset = () => {
    setTypeId(undefined); setWhere('ROOM'); setRoomId(undefined); setArea(undefined);
    setWhen('LAST_NIGHT'); setCustomWhen(null); setDesc(''); setAnonymous(true); setFiles([]);
  };

  /** 发生时段。深夜噪音默认给昨晚 23:00 —— 这是最常见的一种，少点一次是一次 */
  const resolveOccurred = (): Dayjs => {
    if (when === 'LAST_NIGHT') return dayjs().subtract(1, 'day').hour(23).minute(0).second(0);
    if (when === 'TODAY') return dayjs().subtract(2, 'hour');
    return customWhen ?? dayjs();
  };

  /** 手机拍的照动辄 4MB，先在浏览器里缩到 1280px 再传 */
  const compressImage = (file: File): Promise<{ dataBase64: string; mimeType: string; preview: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
          const max = 1280;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          const url = canvas.toDataURL('image/jpeg', 0.8);
          resolve({ dataBase64: url.split(',')[1], mimeType: 'image/jpeg', preview: url });
        };
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = await compressImage(f);
      setFiles((x) => [...x, { kind: 'PHOTO', ...r, name: f.name }]);
    } catch { message.error('图片读取失败'); }
  };

  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return message.error('录音文件过大');
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setFiles((x) => [...x, { kind: 'AUDIO', mimeType: f.type || 'audio/mpeg', dataBase64: url.split(',')[1], name: f.name, preview: url }]);
    };
    reader.readAsDataURL(f);
  };

  /** 录一段声音。噪音投诉里这是最有说服力的证据，而且不用打字、不分语言 */
  const toggleRecord = async () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      // 浏览器不支持就退回选文件，别让功能直接消失
      audioInput.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (ev) => chunks.push(ev.data);
      mr.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size > 4 * 1024 * 1024) { message.error('录音太长了'); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result as string;
          setFiles((x) => [...x, {
            kind: 'AUDIO',
            mimeType: (mr.mimeType || 'audio/webm').split(';')[0],
            dataBase64: url.split(',')[1], name: '录音', preview: url,
          }]);
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      recorder.current = mr;
      setRecording(true);
      // 30 秒足够说明问题，也避免传上来一个几十 MB 的文件
      setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 30000);
    } catch {
      message.warning('没有麦克风权限，可以改成上传文件');
      audioInput.current?.click();
    }
  };

  const submit = async () => {
    if (!typeId) return message.warning(t('cpType'));
    if (where === 'ROOM' && !roomId) return message.warning(t('cpPickRoom'));
    if (where === 'PUBLIC' && !area) return message.warning(t('cpPickArea'));
    setSaving(true);
    try {
      const occurred = resolveOccurred();
      const r = await selfApi.createComplaint({
        typeId, anonymous,
        targetRoomId: where === 'ROOM' ? roomId : null,
        targetFloorId: where === 'PUBLIC' ? opts.myFloorId : null,
        targetArea: where === 'PUBLIC' ? area : undefined,
        occurredFrom: occurred.toISOString(),
        description: desc.trim() || undefined,
      });
      for (const f of files) {
        await selfApi.uploadComplaintAttachment(r.id, {
          kind: f.kind, mimeType: f.mimeType, dataBase64: f.dataBase64, originalName: f.name,
        }).catch(() => message.warning('有一个附件没传上去'));
      }
      message.success(`${t('cpSubmitted')} · ${r.code}`);
      setOpen(false); reset(); load(); reload();
    } catch (e: any) {
      message.error(e.message);
    } finally { setSaving(false); }
  };

  const myFloorRooms = (opts?.floors ?? []).find((f: any) => f.isMine);

  return (
    <div>
      <Button type="primary" size="large" block icon={<PlusOutlined />}
        onClick={() => setOpen(true)} style={{ marginBottom: 10 }}>
        {t('newComplaint')}
      </Button>

      <Alert type="success" showIcon style={{ marginBottom: 12, fontSize: 12 }}
        message={t('cpPrivacyTitle')} description={t('cpAnonymousOn')} />

      <div className="self-card-title" style={{ padding: '0 4px' }}>{t('myComplaints')}</div>

      {rows === null ? <div className="self-center"><Spin /></div>
        : rows.length === 0 ? <div className="self-card"><Empty description={t('noComplaints')} /></div>
        : rows.map((c) => (
          <div className="self-row" key={c.id}>
            <div className="self-row-top">
              <div className="self-row-title">
                {dict(c.type)}
                {c.anonymous && <Tag icon={<EyeInvisibleOutlined />} style={{ marginLeft: 6 }}>{t('cpAnonymous')}</Tag>}
              </div>
              <Tag color={STATUS_COLOR[c.status]}>{cpStatus(c.status)}</Tag>
            </div>
            <div className="self-row-meta">
              {c.code}{c.location ? ` · ${c.location}` : ''}<br />
              {t('cpWhen')}：{dayjs(c.occurredFrom).format('MM-DD HH:mm')}
            </div>
            {c.description && <div style={{ fontSize: 13, marginTop: 6 }}>{c.description}</div>}

            {c.resolution && (
              <div style={{ marginTop: 8, padding: 8, background: '#f6ffed', borderRadius: 6, fontSize: 13 }}>
                <b>{t('cpResult')}</b>：{c.resolution}
              </div>
            )}

            {c.events?.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#8c8c8c' }}>
                {c.events.map((e: any, i: number) => (
                  <div key={i}>· {e.note}（{dayjs(e.createdAt).format('MM-DD HH:mm')}）</div>
                ))}
              </div>
            )}

            <Space style={{ marginTop: 8 }} wrap>
              {c.canWithdraw && (
                <Popconfirm title={t('cpWithdrawConfirm')}
                  onConfirm={async () => { await selfApi.withdrawComplaint(c.id); message.success(t('success')); load(); reload(); }}>
                  <Button size="small">{t('cpWithdraw')}</Button>
                </Popconfirm>
              )}
              {c.canRate && (
                <Space size={6}>
                  <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('cpRateHint')}</span>
                  <Rate style={{ fontSize: 16 }}
                    onChange={async (v) => { await selfApi.rateComplaint(c.id, v); message.success(t('success')); load(); }} />
                </Space>
              )}
              {c.rating != null && <Rate disabled value={c.rating} style={{ fontSize: 14 }} />}
            </Space>
          </div>
        ))}

      {/* ============================== 提交表单 ============================== */}
      <Modal open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={saving}
        title={t('newComplaint')} okText={t('submit')} width={420} styles={{ body: { paddingTop: 8 } }}>
        {!opts ? <Spin /> : (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <div>
              <div className="self-label">{t('cpType')}</div>
              <Select size="large" style={{ width: '100%' }} value={typeId} onChange={setTypeId}
                placeholder={t('cpType')}
                options={opts.types.map((x: any) => ({
                  value: x.id,
                  label: lang === 'zh' ? x.nameZh : lang === 'id' ? x.nameId : x.nameEn,
                }))} />
            </div>

            <div>
              <div className="self-label">{t('cpWhere')}</div>
              <Segmented block value={where} onChange={(v) => setWhere(v as any)}
                options={[
                  { label: t('cpWhereRoom'), value: 'ROOM' },
                  { label: t('cpWherePublic'), value: 'PUBLIC' },
                ]} />
              {where === 'ROOM' ? (
                <>
                  <Select size="large" showSearch style={{ width: '100%', marginTop: 8 }}
                    value={roomId} onChange={setRoomId} placeholder={t('cpPickRoom')}
                    optionFilterProp="label"
                    options={(opts.floors ?? []).map((f: any) => ({
                      label: `${opts.buildingCode}${f.level}F${f.isMine ? ' ←' : ''}`,
                      options: f.rooms
                        .filter((r: any) => !r.isMine)
                        .map((r: any) => ({ value: r.id, label: r.code })),
                    }))} />
                  <div className="self-hint">{t('cpRoomHint')}</div>
                </>
              ) : (
                <Select size="large" style={{ width: '100%', marginTop: 8 }}
                  value={area} onChange={setArea} placeholder={t('cpPickArea')}
                  options={AREAS.map((a) => ({ value: a, label: a }))} />
              )}
            </div>

            <div>
              <div className="self-label">{t('cpWhen')}</div>
              <Segmented block value={when} onChange={(v) => setWhen(v as any)}
                options={[
                  { label: t('cpLastNight'), value: 'LAST_NIGHT' },
                  { label: t('cpToday'), value: 'TODAY' },
                  { label: t('cpOther'), value: 'OTHER' },
                ]} />
              {when === 'OTHER' && (
                <DatePicker showTime size="large" style={{ width: '100%', marginTop: 8 }}
                  value={customWhen} onChange={setCustomWhen}
                  disabledDate={(d) => d.isAfter(dayjs()) || d.isBefore(dayjs().subtract(14, 'day'))} />
              )}
              <div className="self-hint">{t('cpWhenHint')}</div>
            </div>

            <div>
              <div className="self-label">{t('cpPhoto')} / {t('cpAudio')}</div>
              <Space wrap>
                <Button size="large" icon={<CameraOutlined />} onClick={() => photoInput.current?.click()}>
                  {t('cpPhoto')}
                </Button>
                <Button size="large" danger={recording} icon={<AudioOutlined />} onClick={toggleRecord}>
                  {recording ? t('cpRecording') : t('cpAudio')}
                </Button>
              </Space>
              <input ref={photoInput} type="file" accept="image/*" capture="environment"
                hidden onChange={onPickPhoto} />
              <input ref={audioInput} type="file" accept="audio/*" hidden onChange={onPickAudio} />
              {files.length > 0 && (
                <Space wrap style={{ marginTop: 8 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {f.kind === 'PHOTO'
                        ? <img src={f.preview} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }} />
                        : <audio controls src={f.preview} style={{ height: 32, maxWidth: 180 }} />}
                      <Button size="small" type="text" danger icon={<DeleteOutlined />}
                        onClick={() => setFiles((x) => x.filter((_, k) => k !== i))} />
                    </div>
                  ))}
                </Space>
              )}
              <div className="self-hint">{t('cpEvidenceHint')}</div>
            </div>

            <div>
              <div className="self-label">{t('cpDesc')}</div>
              <Input.TextArea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)}
                maxLength={500} showCount placeholder={t('cpDescHint')} />
            </div>

            <div style={{ background: '#fafafa', padding: 10, borderRadius: 8 }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space size={6}><EyeInvisibleOutlined /><b>{t('cpAnonymous')}</b></Space>
                <Switch checked={anonymous} disabled={!canAnon} onChange={setAnonymous} />
              </Space>
              <div className="self-hint" style={{ marginTop: 6 }}>
                {canAnon ? t('cpAnonymousOn') : t('cpAnonymousForced')}
              </div>
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
}
