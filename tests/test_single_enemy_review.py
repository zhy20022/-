import unittest

from scripts import audit_single_enemy_review as review


class ExclusiveReviewTests(unittest.TestCase):
    def rotation(self, number, count, equipped, seed=0, sequence=(1, 2, 3)):
        return review.run((equipped, "rotation", (number, count, True, seed, sequence)))["totalDamage"]

    def test_revised_exclusives_meet_two_enemy_damage_floor(self):
        for number, expected in ((6, 55150), (44, 56536), (30, 55200)):
            for seed in range(3):
                with self.subTest(number=number, seed=seed):
                    self.assertGreaterEqual(expected, 55000)
                    self.assertEqual(self.rotation(number, 2, True, seed), expected)

    def test_jing_requires_a_new_mirage_and_extra_bonus_is_two_enemy_only(self):
        self.assertEqual(self.rotation(6, 2, True, sequence=(2, 2, 2)), 0)
        for count, damage in ((1, 25450), (3, 60350), (5, 67940), (10, 65080)):
            self.assertEqual(self.rotation(6, count, True), damage)

    def test_wuyin_retains_two_marks_outside_two_enemies(self):
        for count, damage in ((1, 37136), (3, 47136), (5, 57136), (10, 77903)):
            self.assertEqual(self.rotation(44, count, True), damage)
        self.assertEqual(self.rotation(44, 2, False, sequence=(3,)), 0)
        self.assertEqual(self.rotation(44, 2, True, sequence=(3,)), 7500)

    def test_wenshizhi_two_enemy_bonus_requires_prepared_c(self):
        self.assertEqual(self.rotation(30, 2, True, sequence=(1, 1, 3)), 44490)
        for count in (1, 3, 5, 10):
            self.assertEqual(self.rotation(30, count, True), self.rotation(30, count, False))

    def test_jiwei_revised_three_enemy_rotation(self):
        for seed in range(3):
            with self.subTest(seed=seed):
                self.assertEqual(self.rotation(46, 3, False, seed), 57294)
                self.assertGreaterEqual(self.rotation(46, 3, True, seed), 67500)
                self.assertEqual(self.rotation(46, 3, True, seed), 68958)
        self.assertEqual(self.rotation(46, 3, False, sequence=(3,)),
                         self.rotation(46, 3, True, sequence=(3,)))

    def test_jiwei_other_enemy_counts_keep_previous_damage(self):
        for count, base, equipped in ((1, 19638, 21096), (2, 31696, 33640),
                                      (5, 74900, 79490), (10, 71400, 74280)):
            with self.subTest(count=count):
                self.assertEqual(self.rotation(46, count, False), base)
                self.assertEqual(self.rotation(46, count, True), equipped)

    def test_wenwei_reads_both_marks_before_c_expires(self):
        self.assertEqual(self.rotation(28, 1, True), self.rotation(28, 1, False))
        for count, increase in ((2, 6000), (3, 12000), (5, 24000), (10, 24000)):
            self.assertEqual(self.rotation(28, count, True) - self.rotation(28, count, False), increase)

    def test_revised_dragon_does_not_consume_an_extra_crit_roll(self):
        for seed in range(3):
            args = (35, 1, True, seed)
            base = review.run((False, "rotation", args))
            equipped = review.run((True, "rotation", args))
            self.assertGreater(equipped["totalDamage"], base["totalDamage"])
            self.assertEqual(equipped["totalDamage"] - base["totalDamage"],
                             equipped["firstRotationDamage"] - base["firstRotationDamage"])

    def test_exclusive_does_not_restore_new_single_enemy_caps(self):
        for n in (3, 11, 13, 22, 45):
            self.assertEqual(self.rotation(n, 1, True), self.rotation(n, 1, False))
