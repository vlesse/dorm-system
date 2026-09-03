import { useEffect, useState } from 'react';
import { Drawer, Input, Table, Tag, Space, Button, App, Alert, Empty, Typography, Select } from 'antd';
import { api } from '../api';
import { useT } from '../i18n';
import { useMeta } from '../meta';

/**
 * 分配床位抽屉。
 * 两种入口：
 *  - 传 bedId：给这张床找人（床位图上点空床）
 *  - 传 personId：给这个人找床（人员列表点分配），会调推荐接口按规则打分排序
 * 硬约束不通过的房间根本不会出现在列表里；软约束不通过的会带提醒，确认后才执行。
 */
export default function AssignDrawer({
  bedId, personId, onClose, onDone,
}: {
  bedId?: number | null;
  personId?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const meta = useMeta();
  const { message, modal } = App.useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [cand, setCand] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [buildingFilter, setBuildingFilter] = useState<number | undefined>();
  const [typeFilter, setTypeFilter] = useState<number | undefined>();
  const [tree, setTree] = useState<any[]>([]);

  useEffect(() => { api.tree().then(setTree); }, []);

  // 给床找人
  useEffect(() => {
    if (!bedId) return;
    setLoading(true);
    api.persons({ q, housed: 'false', employmentStatus: 'ACTIVE', pageSize: 20 })
      .then((r) => setRows(r.rows))
      .finally(() => setLoading(false));
  }, [bedId, q]);

  // 给人找床
  const loadCandidates = () => {
    if (!personId) return;
    setLoading(true);
    api.candidates(personId, { buildingId: buildingFilter, roomTypeId: typeFilter })
      .then(setCand).finally(() => setLoading(false));
  };
  useEffect(loadCandidates, [personId, buildingFilter, typeFilter]);

  const handleError = (e: any, retry: (force: boolean) => void) => {
    if (e.status === 409 && e.body?.warnings) {
      modal.confirm({
        title: t('warnings'), width: 480,
        content: (
          <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
            {e.body.warnings.map((w: any, i: number) => <li key={i}>{w.message}</li>)}
          </ul>
        ),
        okText: '仍然分配', cancelText: t('cancel'), onOk: () => retry(true),
      });
    } else if (e.body?.blockers) {
      modal.error({
        title: '不满足硬性排宿规则',
        content: (
          <ul style={{ paddingLeft: 18 }}>
            {e.body.blockers.map((w: any, i: number) => <li key={i}>{w.message}</li>)}
          </ul>
        ),
      });
    } else message.error(e.message);
  };

  const doAssign = async (pid: number, bid: number) => {
    const run = async (force: boolean) => {
      try {
        await api.assign({ personId: pid, bedId: bid, force });
        message.success('已分配'); onDone();
      } catch (e: any) { handleError(e, run); }
    };
    await run(false);
  };

  const doTransfer = async (pid: number, bid: number) => {
    const run = async (force: boolean) => {
      try {
        await api.transfer({ personId: pid, toBedId: bid, force, reason: '宿管调宿' });
        message.success('已调宿'); onDone();
      } catch (e: any) { handleError(e, run); }
    };
    await run(false);
  };

  return (
    <Drawer
      open={!!bedId || !!personId}
      width={personId ? 860 : 580}
      onClose={onClose}
      title={bedId ? '为这张床选人' : t('recommended')}
    >
      {bedId && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.Search placeholder={t('search')} allowClear onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            只列出「在职 + 尚未安排住宿」的人员。分配时会自动跑一遍排宿规则。
          </Typography.Text>
          <Table
            size="small" rowKey="id" loading={loading} dataSource={rows} pagination={false}
            columns={[
              { title: t('name'), dataIndex: 'name', render: (v, r: any) => (
                  <span>{v} <Tag color={r.nationalityColor}>{r.nationalityId}</Tag>
                    {r.needsLowerBunk && <Tag color="orange">下铺</Tag>}
                    <br /><span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.employeeNo}</span></span>
                ) },
              { title: t('department'), dataIndex: 'department', width: 115 },
              { title: t('positionLevel'), dataIndex: 'positionLevel', width: 80 },
              { title: t('shift'), dataIndex: 'shift', width: 75 },
              { title: '', width: 70, render: (_, r: any) =>
                  <Button size="small" type="primary" onClick={() => doAssign(r.id, bedId)}>{t('confirm')}</Button> },
            ]}
          />
        </Space>
      )}

      {personId && cand && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="info"
            message={
              <span>
                <b>{cand.person.name}</b>（{cand.person.employeeNo}）·{' '}
                <Tag>{cand.person.nationalityId}</Tag>
                <Tag>{cand.person.gender === 'MALE' ? t('male') : t('female')}</Tag>
                {cand.person.department && <Tag>{cand.person.department}</Tag>}
                {cand.person.positionLevel && <Tag>{cand.person.positionLevel}</Tag>}
                {cand.person.shift && <Tag>{cand.person.shift}</Tag>}
                {cand.person.religion && <Tag color="green">{cand.person.religion}</Tag>}
                {cand.person.isSmoker && <Tag>吸烟</Tag>}
                {cand.person.needsLowerBunk && <Tag color="orange">不能睡上铺</Tag>}
                {cand.person.needsGroundFloor && <Tag color="red">需低楼层</Tag>}
                {cand.person.spouseIds.length > 0 && <Tag color="magenta">已登记配偶</Tag>}
              </span>
            }
            description={
              <span>
                按当前排宿规则匹配到 <b>{cand.totalMatched}</b> 间可用房间，下面按契合度排序。
                {cand.person.spouseIds.length > 0 && !cand.person.coupleRoomAllowed &&
                  '（该职级尚未开放夫妻房，可在「设置 → 职级」调整）'}
              </span>
            }
          />
          {cand.currentBed && (
            <Alert type="warning" showIcon
              message={`该人员当前已住 ${cand.currentBed.roomCode} · ${cand.currentBed.bedLabel}，下面的操作会走「调宿」`} />
          )}

          <Space wrap>
            <Select allowClear style={{ width: 200 }} placeholder={t('building')} value={buildingFilter}
              onChange={setBuildingFilter}
              options={tree.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))} />
            <Select allowClear style={{ width: 180 }} placeholder={t('roomType')} value={typeFilter}
              onChange={setTypeFilter}
              options={meta.roomTypes.filter((r: any) => r.isResidential)
                .map((r: any) => ({ value: r.id, label: r.nameZh }))} />
          </Space>

          {cand.candidates.length === 0 ? (
            <Empty description="没有满足硬性规则的可用床位" />
          ) : (
            <Table
              size="small" rowKey={(r: any) => r.room.id} dataSource={cand.candidates} loading={loading}
              pagination={{ pageSize: 8, size: 'small' }}
              columns={[
                { title: '契合度', dataIndex: 'score', width: 75,
                  render: (v) => <Tag color={v >= 150 ? 'green' : v >= 110 ? 'blue' : 'default'}>{v}</Tag> },
                {
                  title: t('room'), width: 220, render: (_, r: any) => (
                    <span>
                      <b>{r.room.code}</b>{' '}
                      <Tag color={r.room.roomType.color} style={{ fontSize: 10 }}>{r.room.roomType.nameZh}</Tag>
                      {r.room.roomType.isCoupleRoom && <Tag color="magenta" style={{ fontSize: 10 }}>夫妻</Tag>}
                      {r.room.isDerated && <Tag color="orange" style={{ fontSize: 10 }}>降标</Tag>}
                      <br />
                      <span style={{ fontSize: 11, color: '#8c8c8c' }}>
                        {r.room.floor?.buildingCode}栋 {r.room.floor?.level}F ·
                        在住 {r.room.beds.filter((b: any) => b.occupancy).length}/{r.room.capacity}
                        {r.room.isDerated && `（标称 ${r.room.nominalCapacity}）`}
                      </span>
                    </span>
                  ),
                },
                { title: '建议铺位', dataIndex: 'suggestedBedLabel', width: 100 },
                { title: t('facilities'), width: 130, render: (_, r: any) => (
                    <Space size={2} wrap>
                      {r.room.hasAC && <Tag style={{ fontSize: 10 }}>空调</Tag>}
                      {r.room.hasBathroom && <Tag style={{ fontSize: 10 }}>独卫</Tag>}
                      {r.room.hasWaterHeater && <Tag style={{ fontSize: 10 }}>热水</Tag>}
                    </Space>
                  ) },
                {
                  title: t('warnings'), render: (_, r: any) =>
                    r.warnings.length === 0
                      ? <Tag color="green">无提醒</Tag>
                      : <Space direction="vertical" size={0}>
                          {r.warnings.map((w: any, i: number) => (
                            <span key={i} style={{ fontSize: 11, color: '#d46b08' }}>· {w.message}</span>
                          ))}
                        </Space>,
                },
                {
                  title: '', width: 80,
                  render: (_, r: any) => (
                    <Button size="small" type="primary"
                      onClick={() => cand.currentBed
                        ? doTransfer(personId, r.suggestedBedId)
                        : doAssign(personId, r.suggestedBedId)}>
                      {cand.currentBed ? t('transfer') : t('assign')}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Space>
      )}
    </Drawer>
  );
}
