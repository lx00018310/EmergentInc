from .utils import neighbors6, coord_to_id

FORBIDDEN_OWNER_STRATEGY = [
    'owner_as_customer', 'owner_payment', '老板付款', '老板购买',
    '老板帮我找客户', '老板选择渠道', 'business_decision', '商业策略',
    '你觉得我应该做什么', '帮我做决定'
]

class RuleValidator:
    def __init__(self, storage):
        self.s = storage
        self.cfg = self.s.config().get('resource', {})

    def action_cost(self, action):
        costs = {
            'WORK': float(self.cfg.get('work_cost', 1.0)),
            'MESSAGE': float(self.cfg.get('transfer_cost', 0.2)),
            'ASK_OWNER': float(self.cfg.get('request_capability_cost', 0.2)),
            'REPRODUCE': float(self.cfg.get('spawn_cost', 10.0)),
            'WAIT': 0.0,
            'IDLE': 0.0
        }
        return costs.get(action, 0.2)

    def validate(self, pixel_id: str, decision: dict, local_view: dict = None):
        st = self.s.pixel_state(pixel_id)
        if not st.get('active'):
            return False, 'inactive pixel'

        act = decision.get('action')
        if not act:
            return False, 'missing action'

        energy = float(st.get('energy', st.get('resource', 0.0)))
        cost = self.action_cost(act)
        if energy < cost:
            return False, f'insufficient energy: has {energy}, requires {cost}'

        # 1. MESSAGE
        if act == 'MESSAGE':
            msg_params = decision.get('message') or decision
            target = msg_params.get('to') or msg_params.get('target_pixel')
            if not target:
                return False, 'MESSAGE requires target'
            if target not in neighbors6(pixel_id):
                return False, f'target {target} is not a 6-neighbor of {pixel_id}'
            energy_xfer = float(msg_params.get('energy', 0.0) or 0.0)
            if energy_xfer < 0:
                return False, 'energy transfer cannot be negative'
            if energy < cost + energy_xfer:
                return False, f'insufficient energy for message + transfer: has {energy}, requires {cost + energy_xfer}'

        # 2. REPRODUCE
        elif act == 'REPRODUCE':
            rep_params = decision.get('reproduce') or decision
            target_pos = rep_params.get('target')
            if not target_pos:
                return False, 'REPRODUCE requires target coordinate'
            if isinstance(target_pos, (list, tuple)):
                target_id = coord_to_id(target_pos)
            else:
                target_id = str(target_pos)
            if target_id not in neighbors6(pixel_id):
                return False, f'reproduce target {target_id} is not a 6-neighbor'
            
            # Check target occupation
            if target_id in self.s.pixel_ids():
                tgt_st = self.s.pixel_state(target_id)
                if tgt_st.get('active'):
                    return False, f'reproduce target {target_id} is already occupied'

            energy_to_child = float(rep_params.get('energy_to_child', 40.0))
            if energy_to_child <= 0:
                return False, 'energy_to_child must be > 0'
            if energy < cost + energy_to_child:
                return False, f'insufficient energy for reproduction: has {energy}, requires {cost + energy_to_child}'

        # 3. ASK_OWNER
        elif act == 'ASK_OWNER':
            req_params = decision.get('owner_request') or decision
            text = f"{req_params.get('question', '')} {req_params.get('needed_resource', '')} {req_params.get('purpose', '')}".lower()
            for bad in FORBIDDEN_OWNER_STRATEGY:
                if bad in text:
                    return False, 'owner cannot be asked for business strategy or to act as customer'

        # 4. WORK
        elif act == 'WORK':
            # Physical legality: check operations list
            work_params = decision.get('work') or decision
            ops = work_params.get('operations')
            if ops is not None and not isinstance(ops, list):
                return False, 'WORK operations must be a list'

        return True, 'VALID'
